import type { FastifyInstance } from 'fastify';
import { createSettlementSchema } from '@evenup/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';
import { logActivity } from '../services/activityService.js';
import { computeBalances } from '../services/balanceService.js';
import { simplifyDebts } from '../services/debtSimplificationService.js';
import { HttpError } from '../lib/HttpError.js';

type SettlementRow = {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amountCents: number;
  date: Date;
  note?: string | null;
  createdAt: Date;
  fromUser: { id: string; name: string };
  toUser: { id: string; name: string };
};

function formatSettlement(s: SettlementRow) {
  return {
    id: s.id,
    groupId: s.groupId,
    fromUserId: s.fromUserId,
    toUserId: s.toUserId,
    fromUserName: s.fromUser.name,
    toUserName: s.toUser.name,
    amountCents: s.amountCents,
    date: s.date.toISOString().slice(0, 10),
    note: s.note ?? undefined,
    createdAt: s.createdAt.toISOString(),
  };
}

export async function settlementRoutes(app: FastifyInstance) {
  app.post(
    '/groups/:id/settlements',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req, reply) => {
      const { id: groupId } = req.params as { id: string };
      const body = createSettlementSchema.parse(req.body);

      const settlement = await prisma.settlement.create({
        data: {
          groupId,
          fromUserId: body.fromUserId,
          toUserId: body.toUserId,
          amountCents: body.amountCents,
          date: new Date(body.date),
          note: body.note,
        },
        include: {
          fromUser: { select: { id: true, name: true } },
          toUser: { select: { id: true, name: true } },
        },
      });

      logActivity(groupId, req.user!.id, 'settlement_recorded', {
        fromName: settlement.fromUser.name,
        toName: settlement.toUser.name,
        amountCents: settlement.amountCents,
      });

      return reply.status(201).send(formatSettlement(settlement));
    },
  );

  app.get(
    '/groups/:id/settlements',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { id: groupId } = req.params as { id: string };

      const settlements = await prisma.settlement.findMany({
        where: { groupId },
        include: {
          fromUser: { select: { id: true, name: true } },
          toUser: { select: { id: true, name: true } },
        },
        orderBy: { date: 'desc' },
      });

      return settlements.map(formatSettlement);
    },
  );

  app.put(
    '/groups/:id/settlements/:settlementId',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { id: groupId, settlementId } = req.params as { id: string; settlementId: string };
      const body = createSettlementSchema.parse(req.body);

      const existing = await prisma.settlement.findFirst({ where: { id: settlementId, groupId } });
      if (!existing) throw new HttpError(404, 'Nicht gefunden');

      const updated = await prisma.settlement.update({
        where: { id: settlementId },
        data: {
          fromUserId: body.fromUserId,
          toUserId: body.toUserId,
          amountCents: body.amountCents,
          date: new Date(body.date),
          note: body.note,
        },
        include: {
          fromUser: { select: { id: true, name: true } },
          toUser: { select: { id: true, name: true } },
        },
      });

      logActivity(groupId, req.user!.id, 'settlement_edited', {
        amountCents: updated.amountCents,
      });

      return formatSettlement(updated);
    },
  );

  app.delete(
    '/groups/:id/settlements/:settlementId',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req, reply) => {
      const { id: groupId, settlementId } = req.params as { id: string; settlementId: string };

      const existing = await prisma.settlement.findFirst({ where: { id: settlementId, groupId } });
      if (!existing) throw new HttpError(404, 'Nicht gefunden');

      await prisma.settlement.delete({ where: { id: settlementId } });

      logActivity(groupId, req.user!.id, 'settlement_deleted', {
        amountCents: existing.amountCents,
      });

      return reply.status(204).send();
    },
  );

  app.get(
    '/groups/:id/settle-up',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { id: groupId } = req.params as { id: string };
      const query = req.query as { simplify?: string };
      const shouldSimplify = query.simplify !== 'false';

      const balances = await computeBalances(groupId);

      if (shouldSimplify) {
        return simplifyDebts(balances);
      }

      return simplifyDebts(balances);
    },
  );
}
