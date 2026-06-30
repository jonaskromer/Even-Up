import type { FastifyInstance } from 'fastify';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';
import { HttpError } from '../lib/HttpError.js';
import { logActivity } from '../services/activityService.js';
import { isEmailConfigured, sendJoinRequestAcceptedEmail } from '../services/emailService.js';

export async function joinRequestsRoutes(app: FastifyInstance) {
  app.get(
    '/groups/:id/join-requests',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { id: groupId } = req.params as { id: string };

      const requests = await prisma.groupJoinRequest.findMany({
        where: { groupId, status: 'pending' },
        include: { invitedUser: { select: { name: true, email: true } } },
        orderBy: { createdAt: 'desc' },
      });

      return requests.map((r) => ({
        id: r.id,
        invitedName: r.invitedUser.name,
        invitedEmail: r.invitedUser.email,
        createdAt: r.createdAt.toISOString(),
      }));
    },
  );

  app.get('/join-requests', { preHandler: [requireAuth] }, async (req) => {
    const requests = await prisma.groupJoinRequest.findMany({
      where: { invitedUserId: req.user!.id, status: 'pending' },
      include: { group: { select: { name: true } }, invitedBy: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((r) => ({
      id: r.id,
      groupId: r.groupId,
      groupName: r.group.name,
      invitedByName: r.invitedBy.name,
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.post('/join-requests/:id/accept', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;

    const request = await prisma.groupJoinRequest.findUnique({
      where: { id },
      include: { invitedBy: { select: { email: true } }, group: { select: { name: true } } },
    });
    if (!request) {
      throw new HttpError(404, 'Anfrage nicht gefunden');
    }
    if (request.invitedUserId !== userId) {
      throw new HttpError(403, 'Diese Anfrage gehört dir nicht');
    }
    if (request.status !== 'pending') {
      throw new HttpError(409, 'Anfrage wurde bereits beantwortet');
    }

    const existingMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: request.groupId, userId } },
    });

    if (existingMember) {
      // Race with the unrelated GroupInvite link flow: already a member, just close out the request.
      await prisma.groupJoinRequest.update({
        where: { id },
        data: { status: 'accepted', respondedAt: new Date() },
      });
      return reply.status(200).send({ message: 'Bereits Mitglied' });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });

    await prisma.$transaction([
      prisma.groupMember.create({ data: { groupId: request.groupId, userId } }),
      prisma.groupJoinRequest.update({
        where: { id },
        data: { status: 'accepted', respondedAt: new Date() },
      }),
    ]);

    logActivity(request.groupId, userId, 'member_joined', {
      memberName: user.name,
      memberEmail: user.email,
    });

    if (isEmailConfigured()) {
      // Fire-and-forget: a notification email failing to send should never block acceptance.
      sendJoinRequestAcceptedEmail(
        request.invitedBy.email,
        user.name,
        request.group.name,
        request.groupId,
      ).catch((err: unknown) => {
        req.log.error({ err }, 'Failed to send join request accepted email');
      });
    }

    return reply.status(200).send({ message: 'Beigetreten' });
  });

  app.post('/join-requests/:id/decline', { preHandler: [requireAuth] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const userId = req.user!.id;

    const request = await prisma.groupJoinRequest.findUnique({ where: { id } });
    if (!request) {
      throw new HttpError(404, 'Anfrage nicht gefunden');
    }
    if (request.invitedUserId !== userId) {
      throw new HttpError(403, 'Diese Anfrage gehört dir nicht');
    }
    if (request.status !== 'pending') {
      throw new HttpError(409, 'Anfrage wurde bereits beantwortet');
    }

    await prisma.groupJoinRequest.update({
      where: { id },
      data: { status: 'declined', respondedAt: new Date() },
    });

    return reply.status(200).send({ message: 'Anfrage abgelehnt' });
  });
}
