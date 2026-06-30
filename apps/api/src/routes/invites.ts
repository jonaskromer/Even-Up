import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';

const INVITE_TTL_DAYS = 7;

export async function inviteRoutes(app: FastifyInstance) {
  app.post(
    '/groups/:id/invites',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req, reply) => {
      const { id: groupId } = req.params as { id: string };
      const userId = req.user!.id;

      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + INVITE_TTL_DAYS);

      const invite = await prisma.groupInvite.create({
        data: { groupId, createdBy: userId, expiresAt },
      });

      return reply.status(201).send({
        token: invite.token,
        expiresAt: invite.expiresAt.toISOString(),
      });
    },
  );

  app.post('/invites/:token/accept', { preHandler: [requireAuth] }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const userId = req.user!.id;

    const invite = await prisma.groupInvite.findUnique({
      where: { token },
      include: { group: { select: { id: true, name: true } } },
    });

    if (!invite || invite.expiresAt < new Date()) {
      return reply.status(404).send({ error: 'Einladungslink ungültig oder abgelaufen' });
    }

    const existing = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: invite.groupId, userId } },
    });

    if (existing) {
      return reply
        .status(200)
        .send({ groupId: invite.groupId, groupName: invite.group.name, alreadyMember: true });
    }

    await prisma.groupMember.create({
      data: { groupId: invite.groupId, userId, role: 'member' },
    });

    return reply
      .status(201)
      .send({ groupId: invite.groupId, groupName: invite.group.name, alreadyMember: false });
  });
}
