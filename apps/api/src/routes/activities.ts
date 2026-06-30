import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/prisma.js';
import { requireAuth } from '../middleware/requireAuth.js';
import { requireGroupMember } from '../middleware/requireGroupMember.js';

const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export async function activityRoutes(app: FastifyInstance) {
  app.get('/activities', { preHandler: [requireAuth] }, async (req) => {
    const { limit, offset } = pageSchema.parse(req.query);
    const userId = req.user!.id;

    const memberships = await prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    const groupIds = memberships.map((m) => m.groupId);

    if (groupIds.length === 0) return { items: [], total: 0 };

    const [activities, total] = await Promise.all([
      prisma.activity.findMany({
        where: { groupId: { in: groupIds } },
        include: {
          user: { select: { id: true, name: true } },
          group: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.activity.count({ where: { groupId: { in: groupIds } } }),
    ]);

    return {
      items: activities.map((a) => ({
        id: a.id,
        groupId: a.groupId,
        groupName: a.group.name,
        type: a.type,
        actorName: a.user.name,
        data: a.data,
        createdAt: a.createdAt.toISOString(),
      })),
      total,
    };
  });

  app.get(
    '/groups/:groupId/activities',
    { preHandler: [requireAuth, requireGroupMember] },
    async (req) => {
      const { groupId } = req.params as { groupId: string };
      const { limit, offset } = pageSchema.parse(req.query);

      const [activities, total] = await Promise.all([
        prisma.activity.findMany({
          where: { groupId },
          include: { user: { select: { id: true, name: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
          skip: offset,
        }),
        prisma.activity.count({ where: { groupId } }),
      ]);

      return {
        items: activities.map((a) => ({
          id: a.id,
          type: a.type,
          actorName: a.user.name,
          data: a.data,
          createdAt: a.createdAt.toISOString(),
        })),
        total,
      };
    },
  );
}
