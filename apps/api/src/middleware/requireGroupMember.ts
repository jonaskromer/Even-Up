import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../db/prisma.js';
import { HttpError } from '../lib/HttpError.js';

export async function requireGroupMember(req: FastifyRequest, _reply: FastifyReply) {
  const params = req.params as { groupId?: string; id?: string };
  const groupId = params.groupId ?? params.id;
  const userId = req.user?.id;

  if (!groupId || !userId) {
    throw new HttpError(400, 'Gruppe oder Benutzer fehlt');
  }

  const membership = await prisma.groupMember.findUnique({
    where: { groupId_userId: { groupId, userId } },
  });

  if (!membership) {
    throw new HttpError(403, 'Kein Mitglied dieser Gruppe');
  }
}
