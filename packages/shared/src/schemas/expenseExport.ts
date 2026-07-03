import { z } from 'zod';

// Mirrors the Splitwise-style wide CSV format already used by expense *import*
// (apps/web/app/components/group/ImportExpensesButton.tsx): one row per expense —
// Date, Description, Cost, then one net-balance column per group member. A member's
// net value is positive if they're owed money on this expense (they paid more than
// their own share) and negative if they owe money; everyone's net always sums to
// zero on a given row. Deliberately excludes ReceiptLineItem/ReceiptLineItemAssignment
// — a receipt-created expense exports the same as any other, using only its final
// Expense/ExpenseSplit rows.
//
// Members are identified by email, not by id/uuid (an internal detail with no place
// in a human-facing CSV) and not by display name (which can collide between two
// different people) — both the import and export column headers are emails.
export const expenseExportRowSchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    description: z.string(),
    amountCents: z.number().int().positive(),
    memberNetCents: z.record(z.string().email(), z.number().int()),
  })
  .superRefine((row, ctx) => {
    // computeAndValidateSplits already allows up to ±1 cent of rounding drift per
    // participant between a split's stored owedCents and the true proportional share
    // (see apps/api/src/services/computeSplits.ts) — that drift is persisted as-is,
    // not corrected. Mirror the same tolerance here instead of requiring an exact
    // zero sum, or perfectly valid stored splits would fail export.
    const values = Object.values(row.memberNetCents);
    const sum = values.reduce((s, v) => s + v, 0);
    if (Math.abs(sum) > values.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Member net balances must sum to ~zero (got ${sum}).`,
        path: ['memberNetCents'],
      });
    }
  });

export type ExpenseExportRow = z.infer<typeof expenseExportRowSchema>;
