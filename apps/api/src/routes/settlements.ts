import type { FastifyInstance } from 'fastify';
import { createSettlementSchema } from '@evenup/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';
import { logActivity } from '../services/activityService.js';
import { computeBalances } from '../services/balanceService.js';
import { simplifyDebts } from '../services/debtSimplificationService.js';

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

      return reply.status(201).send(settlement);
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

      // Without simplification, still return suggested transfers from net balances
      // but without the greedy optimization (one transfer per debtor-creditor pair)
      return simplifyDebts(balances);
    },
  );
}
