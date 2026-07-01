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

export const lineItemSplitModeSchema = z.enum(['equal', 'exact', 'percent', 'shares']);
export type LineItemSplitMode = z.infer<typeof lineItemSplitModeSchema>;

const receiptLineItemAssignmentSchema = z.object({
  userId: z.string().min(1),
  weight: z.number().int().positive().default(1),
  exactCents: z.number().int().nonnegative().optional(),
  percent: z.number().min(0).max(100).optional(),
});

const receiptLineItemSchema = z.object({
  name: z.string().min(1),
  quantity: z.number().positive(),
  priceCents: z.number().int(),
  excluded: z.boolean().default(false),
  splitMode: lineItemSplitModeSchema.default('shares'),
  assignments: z.array(receiptLineItemAssignmentSchema).default([]),
});

// A line item that isn't excluded must be assigned to at least one member, otherwise
// its cost would silently vanish from the resulting split. 'exact'/'percent' modes
// additionally require every assignment to carry the field they need — the actual sum
// checks (must total the item price / 100%) happen server-side in receipts.ts, mirroring
// how computeAndValidateSplits validates the top-level expense split.
function validateLineItems(
  lineItems: z.infer<typeof receiptLineItemSchema>[],
  ctx: z.RefinementCtx,
) {
  lineItems.forEach((item, i) => {
    if (item.excluded) return;
    if (item.assignments.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Nicht ausgeschlossene Positionen benötigen mindestens eine zugewiesene Person.',
        path: [i, 'assignments'],
      });
      return;
    }
    if (item.splitMode === 'exact' && item.assignments.some((a) => a.exactCents == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bei exakter Aufteilung benötigt jede Person einen Betrag.',
        path: [i, 'assignments'],
      });
    }
    if (item.splitMode === 'percent' && item.assignments.some((a) => a.percent == null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Bei prozentualer Aufteilung benötigt jede Person einen Prozentsatz.',
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
