import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createExpenseSchema, updateExpenseSchema } from '@evenup/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';
import { logActivity } from '../services/activityService.js';
import { computeAndValidateSplits } from '../services/computeSplits.js';
import { getRate } from '../services/exchangeRateService.js';
import { HttpError } from '../lib/HttpError.js';

type FormatExpenseInput = {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  originalAmountCents: number;
  originalCurrency: string;
  appliedMarkupRate: number;
  paidByUserId: string;
  paidBy: { id: string; name: string };
  date: Date;
  updatedAt: Date;
  splitMode: string;
  splits: { userId: string; owedCents: number }[];
  receiptStoreName?: string | null;
  lineItems?: {
    id: string;
    name: string;
    quantity: number;
    priceCents: number;
    excluded: boolean;
    splitMode: string;
    assignments: {
      userId: string;
      shareWeight: number;
      exactCents: number | null;
      percent: number | null;
    }[];
  }[];
};

export const expenseInclude = {
  paidBy: { select: { id: true, name: true } },
  splits: true,
  lineItems: { include: { assignments: true }, orderBy: { sortOrder: 'asc' as const } },
};

export function formatExpense(e: FormatExpenseInput) {
  return {
    id: e.id,
    groupId: e.groupId,
    description: e.description,
    amountCents: e.amountCents,
    originalAmountCents: e.originalAmountCents,
    originalCurrency: e.originalCurrency,
    appliedMarkupRate: e.appliedMarkupRate,
    paidByUserId: e.paidByUserId,
    paidByName: e.paidBy.name,
    date: e.date.toISOString().slice(0, 10),
    updatedAt: e.updatedAt.toISOString(),
    splitMode: e.splitMode,
    splits: e.splits.map((s) => ({
      userId: s.userId,
      owedCents: s.owedCents,
    })),
    receiptStoreName: e.receiptStoreName ?? undefined,
    lineItems: (e.lineItems ?? []).map((li) => ({
      id: li.id,
      name: li.name,
      quantity: li.quantity,
      priceCents: li.priceCents,
      excluded: li.excluded,
      splitMode: li.splitMode,
      assignments: li.assignments.map((a) => ({
        userId: a.userId,
        weight: a.shareWeight,
        exactCents: a.exactCents ?? undefined,
        percent: a.percent ?? undefined,
      })),
    })),
  };
}

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function resolveConvertedAmount(
  originalAmountCents: number,
  originalCurrency: string,
  groupCurrency: string,
  dateStr: string,
): Promise<number> {
  if (originalCurrency === groupCurrency) return originalAmountCents;
  const rate = await getRate(dateStr, originalCurrency, groupCurrency);
  return Math.round(originalAmountCents * rate);
}

export async function expensesRoutes(app: FastifyInstance) {
  app.get(
    '/groups/:groupId/expenses',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { groupId } = req.params as { groupId: string };
      const { limit, offset } = pageSchema.parse(req.query);

      const [items, total] = await Promise.all([
        prisma.expense.findMany({
          where: { groupId },
          include: expenseInclude,
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
        }),
        prisma.expense.count({ where: { groupId } }),
      ]);

      return { items: items.map(formatExpense), total };
    },
  );

  app.get(
    '/groups/:groupId/expenses/:expenseId',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { groupId, expenseId } = req.params as { groupId: string; expenseId: string };

      const expense = await prisma.expense.findUnique({
        where: { id: expenseId, groupId },
        include: expenseInclude,
      });

      if (!expense) throw new HttpError(404, 'Ausgabe nicht gefunden.');
      return formatExpense(expense);
    },
  );

  app.post(
    '/groups/:groupId/expenses',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req, reply) => {
      const body = createExpenseSchema.parse(req.body);
      const { groupId } = req.params as { groupId: string };

      const group = await prisma.group.findUniqueOrThrow({
        where: { id: groupId },
        select: { currency: true },
      });

      const originalCurrency = (body.currency ?? group.currency).toUpperCase();
      const dateStr = body.date.slice(0, 10);
      const convertedAmountCents = await resolveConvertedAmount(
        body.amountCents,
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

      // For exact splits in a foreign currency, convert each owed amount too
      let convertedExactSplits = body.exactSplits;
      if (body.exactSplits && originalCurrency !== group.currency) {
        const rate = await getRate(dateStr, originalCurrency, group.currency);
        convertedExactSplits = body.exactSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * rate * markupFactor),
        }));
      } else if (body.exactSplits && markupRate > 0) {
        convertedExactSplits = body.exactSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * markupFactor),
        }));
      }

      const splitData = computeAndValidateSplits(
        body.splitMode,
        finalAmountCents,
        convertedExactSplits,
        members.map((m) => m.userId),
      );

      const expense = await prisma.expense.create({
        data: {
          groupId,
          description: body.description,
          amountCents: finalAmountCents,
          originalAmountCents: body.amountCents,
          originalCurrency,
          appliedMarkupRate: markupRate,
          paidByUserId: body.paidByUserId,
          date: new Date(body.date),
          splitMode: body.splitMode,
          splits: {
            createMany: {
              data: splitData,
            },
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
    '/groups/:groupId/expenses/:expenseId',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { groupId, expenseId } = req.params as { groupId: string; expenseId: string };
      const body = updateExpenseSchema.parse(req.body);

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

      const originalCurrency = (body.currency ?? group.currency).toUpperCase();
      const dateStr = body.date.slice(0, 10);
      const convertedAmountCents = await resolveConvertedAmount(
        body.amountCents,
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

      let convertedExactSplits = body.exactSplits;
      if (body.exactSplits && originalCurrency !== group.currency) {
        const rate = await getRate(dateStr, originalCurrency, group.currency);
        convertedExactSplits = body.exactSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * rate * markupFactor),
        }));
      } else if (body.exactSplits && markupRate > 0) {
        convertedExactSplits = body.exactSplits.map((s) => ({
          userId: s.userId,
          owedCents: Math.round(s.owedCents * markupFactor),
        }));
      }

      const splitData = computeAndValidateSplits(
        body.splitMode,
        finalAmountCents,
        convertedExactSplits,
        members.map((m) => m.userId),
      );

      await prisma.expenseSplit.deleteMany({ where: { expenseId } });

      const expense = await prisma.expense.update({
        where: { id: expenseId },
        data: {
          description: body.description,
          amountCents: finalAmountCents,
          originalAmountCents: body.amountCents,
          originalCurrency,
          appliedMarkupRate: markupRate,
          paidByUserId: body.paidByUserId,
          date: new Date(body.date),
          splitMode: body.splitMode,
          splits: {
            createMany: {
              data: splitData,
            },
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

  app.delete(
    '/groups/:groupId/expenses/:expenseId',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req, reply) => {
      const { groupId, expenseId } = req.params as { groupId: string; expenseId: string };

      const expense = await prisma.expense.findUnique({
        where: { id: expenseId },
        select: { description: true, amountCents: true },
      });

      await prisma.expenseSplit.deleteMany({ where: { expenseId } });
      await prisma.expense.delete({ where: { id: expenseId } });

      if (expense) {
        logActivity(groupId, req.user!.id, 'expense_deleted', {
          description: expense.description,
          amountCents: expense.amountCents,
        });
      }

      return reply.status(204).send();
    },
  );
}
