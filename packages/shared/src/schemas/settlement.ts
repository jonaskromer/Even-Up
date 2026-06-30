import { z } from 'zod';

export const createSettlementSchema = z.object({
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  amountCents: z.number().int().positive(),
  date: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  note: z.string().optional(),
});

export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
