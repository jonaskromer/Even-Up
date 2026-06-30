import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createExpenseSchema, updateExpenseSchema } from '@evenup/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';
import { logActivity } from '../services/activityService.js';
import { computeAndValidateSplits } from '../services/computeSplits.js';
import { HttpError } from '../lib/HttpError.js';

function formatExpense(e: {
  id: string;
  groupId: string;
  description: string;
  amountCents: number;
  paidByUserId: string;
  paidBy: { id: string; name: string };
  date: Date;
  updatedAt: Date;
  splitMode: string;
  splits: { userId: string; owedCents: number }[];
}) {
  return {
    id: e.id,
    groupId: e.groupId,
    description: e.description,
    amountCents: e.amountCents,
    paidByUserId: e.paidByUserId,
    paidByName: e.paidBy.name,
    date: e.date.toISOString().slice(0, 10),
    updatedAt: e.updatedAt.toISOString(),
    splitMode: e.splitMode,
    splits: e.splits.map((s) => ({
      userId: s.userId,
      owedCents: s.owedCents,
    })),
  };
}

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

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
          include: {
            paidBy: { select: { id: true, name: true } },
            splits: true,
          },
          orderBy: [{ date: 'desc' }, { id: 'desc' }],
          take: limit,
          skip: offset,
        }),
        prisma.expense.count({ where: { groupId } }),
      ]);

      return { items: items.map(formatExpense), total };
    },
  );

  app.post(
    '/groups/:groupId/expenses',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req, reply) => {
      const body = createExpenseSchema.parse(req.body);
      const { groupId } = req.params as { groupId: string };

      const members = await prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });

      const splitData = computeAndValidateSplits(
        body.splitMode,
        body.amountCents,
        body.exactSplits,
        members.map((m) => m.userId),
      );

      const expense = await prisma.expense.create({
        data: {
          groupId,
          description: body.description,
          amountCents: body.amountCents,
          paidByUserId: body.paidByUserId,
          date: new Date(body.date),
          splitMode: body.splitMode,
          splits: {
            createMany: {
              data: splitData,
            },
          },
        },
        include: {
          paidBy: { select: { id: true, name: true } },
          splits: true,
        },
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

      const members = await prisma.groupMember.findMany({
        where: { groupId },
        select: { userId: true },
      });

      const splitData = computeAndValidateSplits(
        body.splitMode,
        body.amountCents,
        body.exactSplits,
        members.map((m) => m.userId),
      );

      await prisma.expenseSplit.deleteMany({ where: { expenseId } });

      const expense = await prisma.expense.update({
        where: { id: expenseId },
        data: {
          description: body.description,
          amountCents: body.amountCents,
          paidByUserId: body.paidByUserId,
          date: new Date(body.date),
          splitMode: body.splitMode,
          splits: {
            createMany: {
              data: splitData,
            },
          },
        },
        include: {
          paidBy: { select: { id: true, name: true } },
          splits: true,
        },
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
