import type { FastifyInstance } from 'fastify';
import { createGroupSchema, addMemberSchema } from '@evenup/shared';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';
import { computeBalances } from '../services/balanceService.js';
import { HttpError } from '../lib/HttpError.js';
import { logActivity } from '../services/activityService.js';
import { isEmailConfigured, sendJoinRequestEmail } from '../services/emailService.js';

function formatGroup(g: {
  id: string;
  name: string;
  members: { role: string; user: { id: string; name: string; email: string } }[];
}) {
  return {
    id: g.id,
    name: g.name,
    members: g.members.map((m) => ({
      id: m.user.id,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
    })),
  };
}

export async function groupsRoutes(app: FastifyInstance) {
  app.addHook('onRequest', requireAuth);

  app.get('/', async (req) => {
    const groups = await prisma.group.findMany({
      where: { members: { some: { userId: req.user!.id } } },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return groups.map(formatGroup);
  });

  app.post('/', async (req, reply) => {
    const body = createGroupSchema.parse(req.body);

    const group = await prisma.group.create({
      data: {
        name: body.name,
        members: { create: { userId: req.user!.id, role: 'owner' } },
      },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    return reply.status(201).send(formatGroup(group));
  });

  app.get('/:id', { preHandler: [requireGroupMember] }, async (req) => {
    const { id } = req.params as { id: string };

    const group = await prisma.group.findUniqueOrThrow({
      where: { id },
      include: {
        members: { include: { user: { select: { id: true, name: true, email: true } } } },
      },
    });

    return formatGroup(group);
  });

  app.post('/:id/members', { preHandler: [requireGroupMember] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = addMemberSchema.parse(req.body);

    const user = await prisma.user.findUnique({ where: { email: body.email } });
    if (!user) {
      throw new HttpError(404, 'Benutzer mit dieser E-Mail nicht gefunden');
    }

    if (user.id === req.user!.id) {
      throw new HttpError(400, 'Du kannst dich nicht selbst einladen');
    }

    const existingMember = await prisma.groupMember.findUnique({
      where: { groupId_userId: { groupId: id, userId: user.id } },
    });
    if (existingMember) {
      throw new HttpError(409, 'Ist bereits Mitglied dieser Gruppe');
    }

    const existingRequest = await prisma.groupJoinRequest.findFirst({
      where: { groupId: id, invitedUserId: user.id, status: 'pending' },
    });
    if (existingRequest) {
      throw new HttpError(409, 'Anfrage an diesen Benutzer ist bereits ausstehend');
    }

    const group = await prisma.group.findUniqueOrThrow({ where: { id }, select: { name: true } });

    await prisma.groupJoinRequest.create({
      data: { groupId: id, invitedUserId: user.id, invitedByUserId: req.user!.id },
    });

    logActivity(id, req.user!.id, 'member_invited', {
      memberName: user.name,
      memberEmail: user.email,
    });

    if (isEmailConfigured()) {
      // Fire-and-forget: a notification email failing to send should never block the invite.
      sendJoinRequestEmail(user.email, req.user!.name, group.name).catch((err: unknown) => {
        req.log.error({ err }, 'Failed to send join request email');
      });
    }

    return reply.status(201).send({ message: 'Anfrage gesendet' });
  });

  app.get('/:id/balances', { preHandler: [requireGroupMember] }, async (req) => {
    const { id } = req.params as { id: string };
    return computeBalances(id);
  });
}
