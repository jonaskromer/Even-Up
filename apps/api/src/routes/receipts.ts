import type { FastifyInstance } from 'fastify';
import { createReceiptExpenseSchema, updateReceiptExpenseSchema } from '@evenup/shared';
import type { CreateReceiptExpenseInput } from '@evenup/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';
import { logActivity } from '../services/activityService.js';
import { computeAndValidateSplits } from '../services/computeSplits.js';
import { getRate } from '../services/exchangeRateService.js';
import { parseReceiptImage, isReceiptParsingEnabled } from '../services/geminiReceiptService.js';
import { formatExpense, expenseInclude, resolveConvertedAmount } from './expenses.js';
import { HttpError } from '../lib/HttpError.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

// Splits each non-excluded line item's priceCents across its assignees proportional to
// weight (rounding drift patched onto the last assignee), then aggregates the result
// into one exactSplits-shaped array per user across all line items.
function computeLineItemSplits(
  lineItems: CreateReceiptExpenseInput['lineItems'],
): { userId: string; owedCents: number }[] {
  const totals = new Map<string, number>();

  for (const item of lineItems) {
    if (item.excluded) continue;
    const totalWeight = item.assignments.reduce((sum, a) => sum + a.weight, 0);
    if (totalWeight === 0) continue;

    let allocated = 0;
    item.assignments.forEach((a, i) => {
      const isLast = i === item.assignments.length - 1;
      const share = isLast
        ? item.priceCents - allocated
        : Math.round((item.priceCents * a.weight) / totalWeight);
      allocated += share;
      totals.set(a.userId, (totals.get(a.userId) ?? 0) + share);
    });
  }

  return Array.from(totals.entries()).map(([userId, owedCents]) => ({ userId, owedCents }));
}

function totalAmountCents(lineItems: CreateReceiptExpenseInput['lineItems']): number {
  return lineItems.filter((li) => !li.excluded).reduce((sum, li) => sum + li.priceCents, 0);
}

export async function receiptRoutes(app: FastifyInstance) {
  app.post(
    '/groups/:groupId/receipts/parse',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      if (!isReceiptParsingEnabled()) {
        throw new HttpError(404, 'Beleg-Scan ist auf diesem Server nicht aktiviert.');
      }

      const file = await req.file();
      if (!file) throw new HttpError(400, 'Keine Datei hochgeladen.');
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new HttpError(400, 'Nur Bilddateien (JPEG, PNG, WEBP, HEIC) sind erlaubt.');
      }

      const buffer = await file.toBuffer();
      const parsed = await parseReceiptImage(buffer.toString('base64'), file.mimetype);
      return parsed;
    },
  );

  app.post(
    '/groups/:groupId/receipts',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req, reply) => {
      const body = createReceiptExpenseSchema.parse(req.body);
      const { groupId } = req.params as { groupId: string };

      const group = await prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { currency: true },
      });

      const amountCents = totalAmountCents(body.lineItems);
      if (amountCents <= 0) {
        throw new HttpError(422, 'Der Ausgabenbetrag muss positiv sein.');
      }

      const originalCurrency = (body.currency ?? group.currency).toUpperCase();
      const dateStr = body.date.slice(0, 10);
      const convertedAmountCents = await resolveConvertedAmount(
        amountCents,
        originalCurrency,
        group.currency,
        dateStr,
      );

      const markupRate = body.markupRate ?? 0;
      const markupFactor = 1 + markupRate / 100;
      const finalAmountCents = Math.round(convertedAmountCents * markupFactor);

      const members = await prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });

      const rawSplits = computeLineItemSplits(body.lineItems);
      let convertedExactSplits = rawSplits;
      if (originalCurrency !== group.currency) {
        const rate = await getRate(dateStr, originalCurrency, group.currency);
        convertedExactSplits = rawSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * rate * markupFactor),
        }));
      } else if (markupRate > 0) {
        convertedExactSplits = rawSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * markupFactor),
        }));
      }

      const splitData = computeAndValidateSplits(
        'exact',
        finalAmountCents,
        convertedExactSplits,
        members.map((m) => m.userId),
      );

      const expense = await prisma.expense.create({
        data: {
          groupId,
          description: body.storeName,
          receiptStoreName: body.storeName,
          amountCents: finalAmountCents,
          originalAmountCents: amountCents,
          originalCurrency,
          appliedMarkupRate: markupRate,
          paidByUserId: body.paidByUserId,
          date: new Date(body.date),
          splitMode: 'exact',
          splits: { createMany: { data: splitData } },
          lineItems: {
            create: body.lineItems.map((li, i) => ({
              name: li.name,
              quantity: li.quantity,
              priceCents: li.priceCents,
              excluded: li.excluded,
              sortOrder: i,
              assignments: {
                createMany: {
                  data: li.assignments.map((a) => ({ userId: a.userId, shareWeight: a.weight })),
                },
              },
            })),
          },
        },
        include: expenseInclude,
      });

      logActivity(groupId, req.user!.id, 'expense_created', {
        description: expense.description,
        amountCents: expense.amountCents,
      });

      return reply.status(201).send(formatExpense(expense));
    },
  );

  app.put(
    '/groups/:groupId/receipts/:expenseId',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { groupId, expenseId } = req.params as { groupId: string; expenseId: string };
      const body = updateReceiptExpenseSchema.parse(req.body);

      const current = await prisma.expense.findUnique({
        where: { id: expenseId, groupId },
        select: { updatedAt: true },
      });
      if (!current) throw new HttpError(404, 'Ausgabe nicht gefunden.');
      if (current.updatedAt.toISOString() !== body.updatedAt) {
        throw new HttpError(
          409,
          'Die Ausgabe wurde zwischenzeitlich geändert. Bitte lade die Seite neu und versuche es erneut.',
        );
      }

      const group = await prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { currency: true },
      });

      const amountCents = totalAmountCents(body.lineItems);
      if (amountCents <= 0) {
        throw new HttpError(422, 'Der Ausgabenbetrag muss positiv sein.');
      }

      const originalCurrency = (body.currency ?? group.currency).toUpperCase();
      const dateStr = body.date.slice(0, 10);
      const convertedAmountCents = await resolveConvertedAmount(
        amountCents,
        originalCurrency,
        group.currency,
        dateStr,
      );

      const markupRate = body.markupRate ?? 0;
      const markupFactor = 1 + markupRate / 100;
      const finalAmountCents = Math.round(convertedAmountCents * markupFactor);

      const members = await prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });

      const rawSplits = computeLineItemSplits(body.lineItems);
      let convertedExactSplits = rawSplits;
      if (originalCurrency !== group.currency) {
        const rate = await getRate(dateStr, originalCurrency, group.currency);
        convertedExactSplits = rawSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * rate * markupFactor),
        }));
      } else if (markupRate > 0) {
        convertedExactSplits = rawSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * markupFactor),
        }));
      }

      const splitData = computeAndValidateSplits(
        'exact',
        finalAmountCents,
        convertedExactSplits,
        members.map((m) => m.userId),
      );

      // Replace-all semantics, same pattern as the plain expense PUT handler.
      await prisma.expenseSplit.deleteMany({ where: { expenseId } });
      await prisma.receiptLineItem.deleteMany({ where: { expenseId } }); // cascades assignments

      const expense = await prisma.expense.update({
        where: { id: expenseId },
        data: {
          description: body.storeName,
          receiptStoreName: body.storeName,
          amountCents: finalAmountCents,
          originalAmountCents: amountCents,
          originalCurrency,
          appliedMarkupRate: markupRate,
          paidByUserId: body.paidByUserId,
          date: new Date(body.date),
          splitMode: 'exact',
          splits: { createMany: { data: splitData } },
          lineItems: {
            create: body.lineItems.map((li, i) => ({
              name: li.name,
              quantity: li.quantity,
              priceCents: li.priceCents,
              excluded: li.excluded,
              sortOrder: i,
              assignments: {
                createMany: {
                  data: li.assignments.map((a) => ({ userId: a.userId, shareWeight: a.weight })),
                },
              },
            })),
          },
        },
        include: expenseInclude,
      });

      logActivity(groupId, req.user!.id, 'expense_edited', {
        description: expense.description,
        amountCents: expense.amountCents,
      });

      return formatExpense(expense);
    },
  );
}
