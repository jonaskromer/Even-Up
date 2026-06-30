import { HttpError } from '../lib/HttpError.js';

type Split = { userId: string; owedCents: number };

/**
 * Returns the authoritative split rows to persist.
 *
 * - equal:   always recomputed server-side; any client-sent exactSplits are ignored.
 * - exact / percent / shares: client sends pre-computed owedCents as exactSplits.
 *   We validate membership, uniqueness, and that the sum matches amountCents within
 *   a rounding tolerance of ±memberCount cents (Math.round can drift by 1 ct per member).
 *
 * Throws HttpError 422 on any violation.
 */
export function computeAndValidateSplits(
  splitMode: string,
  amountCents: number,
  exactSplits: Split[] | undefined,
  memberIds: string[],
): Split[] {
  if (splitMode === 'equal') {
    const share = Math.round(amountCents / memberIds.length);
    return memberIds.map((id) => ({ userId: id, owedCents: share }));
  }

  if (!exactSplits || exactSplits.length === 0) {
    throw new HttpError(422, `splitMode "${splitMode}" erfordert exactSplits.`);
  }

  const memberSet = new Set(memberIds);

  const nonMembers = exactSplits.filter((s) => !memberSet.has(s.userId));
  if (nonMembers.length > 0) {
    throw new HttpError(422, 'exactSplits enthält Nutzer, die nicht Mitglied der Gruppe sind.');
  }

  const seen = new Set<string>();
  for (const s of exactSplits) {
    if (seen.has(s.userId)) {
      throw new HttpError(422, 'exactSplits enthält doppelte Einträge für denselben Nutzer.');
    }
    seen.add(s.userId);
  }

  const sum = exactSplits.reduce((acc, s) => acc + s.owedCents, 0);
  // Allow ±memberCount cents to absorb per-member Math.round drift
  if (Math.abs(sum - amountCents) > memberIds.length) {
    throw new HttpError(
      422,
      `Die Summe der Splits (${sum} ct) weicht vom Gesamtbetrag (${amountCents} ct) ab.`,
    );
  }

  return exactSplits;
}
