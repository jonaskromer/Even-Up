import { z } from 'zod';

// Raw shape returned by Gemini after structured-output extraction. Validated before
// the backend trusts anything from the model.
export const geminiReceiptResultSchema = z.object({
  store_name: z.string().min(1),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  line_items: z
    .array(
      z.object({
        name: z.string().min(1),
        quantity: z.number().positive(),
        price: z.number(),
      }),
    )
    .min(1),
  subtotal: z.number().optional(),
  grand_total: z.number(),
});

export type GeminiReceiptResult = z.infer<typeof geminiReceiptResultSchema>;

const receiptLineItemAssignmentSchema = z.object({
  userId: z.string().min(1),
  weight: z.number().int().positive().default(1),
});

const receiptLineItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
  priceCents: z.number().int(),
  excluded: z.boolean().default(false),
  assignments: z.array(receiptLineItemAssignmentSchema).default([]),
});

// A line item that isn't excluded must be assigned to at least one member, otherwise
// its cost would silently vanish from the resulting split.
function validateLineItems(
  lineItems: z.infer<typeof receiptLineItemSchema>[],
  ctx: z.RefinementCtx,
) {
  lineItems.forEach((item, i) => {
    if (!item.excluded && item.assignments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Nicht ausgeschlossene Positionen benötigen mindestens eine zugewiesene Person.',
        path: [i, 'assignments'],
      });
    }
  });
}

export const createReceiptExpenseSchema = z.object({
  storeName: z.string().min(1),
  paidByUserId: z.string().min(1),
  date: z
    .string()
    .datetime()
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  currency: z.string().length(3).optional(),
  markupRate: z.number().min(0).max(100).default(0).optional(),
  lineItems: z.array(receiptLineItemSchema).min(1).superRefine(validateLineItems),
});

// PUT extends POST with a required updatedAt for optimistic concurrency control,
// mirroring updateExpenseSchema.
export const updateReceiptExpenseSchema = createReceiptExpenseSchema.extend({
  updatedAt: z.string().datetime(),
});

export type CreateReceiptExpenseInput = z.infer<typeof createReceiptExpenseSchema>;
export type UpdateReceiptExpenseInput = z.infer<typeof updateReceiptExpenseSchema>;
