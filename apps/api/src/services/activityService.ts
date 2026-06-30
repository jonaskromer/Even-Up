import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';

export type ActivityType =
  | 'expense_created'
  | 'expense_edited'
  | 'expense_deleted'
  | 'member_added'
  | 'member_invited'
  | 'member_joined'
  | 'settlement_recorded'
  | 'settlement_edited'
  | 'settlement_deleted';

export function logActivity(
  groupId: string,
  userId: string,
  type: ActivityType,
  data: Record<string, unknown>,
): void {
  prisma.activity
    .create({ data: { groupId, userId, type, data: data as Prisma.InputJsonValue } })
    .catch(() => {});
}
