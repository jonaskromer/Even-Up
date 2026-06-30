import { z } from 'zod';

export const createExpenseSchema = z.object({
  description: z.string().min(1),
  amountCents: z.number().int().positive(),
  currency: z.string().length(3).optional(),
  paidByUserId: z.string().min(1),
  date: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  splitMode: z.enum(['equal', 'exact', 'percent', 'shares']).default('equal'),
  exactSplits: z
    .array(z.object({ userId: z.string().min(1), owedCents: z.number().int().nonnegative() }))
    .optional(),
});

// PUT extends POST with a required updatedAt for optimistic concurrency control.
// The server rejects the update with 409 if updatedAt no longer matches the DB row.
export const updateExpenseSchema = createExpenseSchema.extend({
  updatedAt: z.string().datetime(),
});

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;
export type SplitMode = CreateExpenseInput['splitMode'];
