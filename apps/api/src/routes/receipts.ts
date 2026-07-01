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

type ReceiptLineItemInput = CreateReceiptExpenseInput['lineItems'][number];

// Splits a single line item's priceCents across its assignees according to its own
// splitMode — mirrors the top-level expense's equal/exact/percent/shares modes, but
// scoped to one item's price and its assigned members. Any rounding drift is patched
// onto the last assignee, same convention used everywhere else in this app.
function computeSingleItemSplit(
  item: ReceiptLineItemInput,
): { userId: string; owedCents: number }[] {
  const n = item.assignments.length;
  if (n === 0) return [];

  if (item.splitMode === 'exact') {
    const sum = item.assignments.reduce((s, a) => s + (a.exactCents ?? 0), 0);
    if (Math.abs(sum - item.priceCents) > n) {
      throw new HttpError(
        422,
        `Die exakten Beträge für "${item.name}" (${sum} ct) weichen vom Positionspreis (${item.priceCents} ct) ab.`,
      );
    }
    return item.assignments.map((a) => ({ userId: a.userId, owedCents: a.exactCents ?? 0 }));
  }

  if (item.splitMode === 'percent') {
    const totalPct = item.assignments.reduce((s, a) => s + (a.percent ?? 0), 0);
    if (Math.abs(totalPct - 100) > 0.5) {
      throw new HttpError(
        422,
        `Die Prozentsätze für "${item.name}" (${totalPct}%) ergeben nicht 100%.`,
      );
    }
    let allocated = 0;
    return item.assignments.map((a, i) => {
      const isLast = i === n - 1;
      const owedCents = isLast
        ? item.priceCents - allocated
        : Math.round((item.priceCents * (a.percent ?? 0)) / 100);
      allocated += owedCents;
      return { userId: a.userId, owedCents };
    });
  }

  if (item.splitMode === 'equal') {
    const base = Math.floor(item.priceCents / n);
    const remainder = item.priceCents - base * n;
    return item.assignments.map((a, i) => ({
      userId: a.userId,
      owedCents: base + (i === n - 1 ? remainder : 0),
    }));
  }

  // 'shares'
  const totalWeight = item.assignments.reduce((sum, a) => sum + a.weight, 0);
  if (totalWeight === 0) return [];
  let allocated = 0;
  return item.assignments.map((a, i) => {
    const isLast = i === n - 1;
    const owedCents = isLast
      ? item.priceCents - allocated
      : Math.round((item.priceCents * a.weight) / totalWeight);
    allocated += owedCents;
    return { userId: a.userId, owedCents };
  });
}

// Aggregates every non-excluded line item's per-assignee split into one
// exactSplits-shaped array per user across all line items.
function computeLineItemSplits(
  lineItems: CreateReceiptExpenseInput['lineItems'],
): { userId: string; owedCents: number }[] {
  const totals = new Map<string, number>();

  for (const item of lineItems) {
    if (item.excluded) continue;
    for (const s of computeSingleItemSplit(item)) {
      totals.set(s.userId, (totals.get(s.userId) ?? 0) + s.owedCents);
    }
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
    async (req, reply) => {
      if (!isReceiptParsingEnabled()) {
        throw new HttpError(404, 'Beleg-Scan ist auf diesem Server nicht aktiviert.');
      }

      const file = await req.file();
      if (!file) throw new HttpError(400, 'Keine Datei hochgeladen.');
      if (!ALLOWED_MIME_TYPES.has(file.mimetype)) {
        throw new HttpError(400, 'Nur Bilddateien (JPEG, PNG, WEBP, HEIC) sind erlaubt.');
      }

      const buffer = await file.toBuffer();

      // Validation above still goes through Fastify's normal JSON error handling.
      // From here on, the response is streamed as newline-delimited JSON so the
      // client can show real retry/fallback progress while Gemini is still running —
      // reply.hijack() tells Fastify not to also try to send its own response.
      // reply.getHeaders() must be captured explicitly: hijacking skips Fastify's
      // normal reply-finalization, so headers staged by other plugins (notably
      // @fastify/cors's Access-Control-Allow-Origin, set via reply.header()) would
      // otherwise never be flushed to the raw response and the browser would reject
      // the cross-origin request outright.
      const priorHeaders = reply.getHeaders();
      reply.hijack();
      for (const [key, value] of Object.entries(priorHeaders)) {
        if (value !== undefined) reply.raw.setHeader(key, value);
      }
      reply.raw.writeHead(200, {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-cache',
      });
      const writeEvent = (event: Record<string, unknown>) => {
        reply.raw.write(`${JSON.stringify(event)}\n`);
      };

      try {
        const parsed = await parseReceiptImage(
          buffer.toString('base64'),
          file.mimetype,
          (progress) => writeEvent({ type: 'progress', ...progress }),
        );
        writeEvent({ type: 'result', data: parsed });
      } catch (err) {
        const status = err instanceof HttpError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        writeEvent({ type: 'error', status, message });
      } finally {
        reply.raw.end();
      }
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
              splitMode: li.splitMode,
              assignments: {
                createMany: {
                  data: li.assignments.map((a) => ({
                    userId: a.userId,
                    shareWeight: a.weight,
                    exactCents: a.exactCents,
                    percent: a.percent,
                  })),
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
              splitMode: li.splitMode,
              assignments: {
                createMany: {
                  data: li.assignments.map((a) => ({
                    userId: a.userId,
                    shareWeight: a.weight,
                    exactCents: a.exactCents,
                    percent: a.percent,
                  })),
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
