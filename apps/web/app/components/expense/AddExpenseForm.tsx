import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { Group, Member, SplitMode, NewExpenseInput } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { SplitModeToggle } from './SplitModeToggle';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';
import { cn } from '../../lib/utils';

interface ExpenseDefaults {
  description: string;
  amountCents: number;
  paidByUserId: string;
  splitMode: SplitMode;
  date: string;
  splits?: { userId: string; owedCents: number }[];
}

interface AddExpenseFormProps {
  group: Group;
  submitting: boolean;
  submitError: string | null;
  onCancel: () => void;
  onSubmit: (input: NewExpenseInput) => void;
  title?: string;
  subtitle?: string;
  defaults?: ExpenseDefaults;
}

function parseEurosToCents(input: string): number {
  const normalized = input.replace(',', '.').trim();
  const value = Number.parseFloat(normalized);
  if (Number.isNaN(value) || value < 0) return 0;
  return Math.round(value * 100);
}

function initParticipants(
  splits: { userId: string; owedCents: number }[] | undefined,
  members: Member[],
): Set<string> {
  if (splits && splits.length > 0) {
    return new Set(splits.map((s) => s.userId));
  }
  return new Set(members.map((m) => m.id));
}

function initSplitInputs(
  mode: SplitMode,
  members: Member[],
  splits: { userId: string; owedCents: number }[] | undefined,
  amountCents: number,
): Record<string, string> {
  if (!splits || mode === 'equal') return {};
  if (mode === 'exact') {
    return Object.fromEntries(splits.map((s) => [s.userId, (s.owedCents / 100).toFixed(2)]));
  }
  if (mode === 'percent' && amountCents > 0) {
    return Object.fromEntries(
      splits.map((s) => [s.userId, ((s.owedCents / amountCents) * 100).toFixed(1)]),
    );
  }
  return Object.fromEntries(members.map((m) => [m.id, '1']));
}

function prefillSplitInputs(
  mode: SplitMode,
  members: Member[],
  amountCents: number,
): Record<string, string> {
  const n = members.length;
  if (n === 0 || mode === 'equal') return {};
  if (mode === 'exact') {
    const share = amountCents > 0 ? (amountCents / n / 100).toFixed(2) : '0.00';
    return Object.fromEntries(members.map((m) => [m.id, share]));
  }
  if (mode === 'percent') {
    const share = (100 / n).toFixed(1);
    return Object.fromEntries(members.map((m) => [m.id, share]));
  }
  return Object.fromEntries(members.map((m) => [m.id, '1']));
}

function computeExactSplits(
  mode: SplitMode,
  members: Member[],
  splitInputs: Record<string, string>,
  amountCents: number,
  t: (key: string, vars?: Record<string, string | number>) => string,
): { userId: string; owedCents: number }[] | { error: string } {
  if (mode === 'equal') return [];

  if (mode === 'exact') {
    const splits = members.map((m) => ({
      userId: m.id,
      owedCents: parseEurosToCents(splitInputs[m.id] ?? '0'),
    }));
    const sum = splits.reduce((acc, s) => acc + s.owedCents, 0);
    if (sum !== amountCents) {
      const diff = ((amountCents - sum) / 100).toFixed(2);
      return {
        error:
          parseFloat(diff) > 0
            ? t('expense.form.splitExactRemaining', { diff })
            : t('expense.form.splitExactOver', { diff: Math.abs(parseFloat(diff)).toFixed(2) }),
      };
    }
    return splits;
  }

  if (mode === 'percent') {
    const percents = members.map((m) => {
      const val = parseFloat((splitInputs[m.id] ?? '0').replace(',', '.'));
      return isNaN(val) ? 0 : val;
    });
    const totalPct = percents.reduce((a, b) => a + b, 0);
    if (Math.abs(totalPct - 100) > 0.5) {
      return {
        error:
          totalPct < 100
            ? t('expense.form.splitPctRemaining', { x: (100 - totalPct).toFixed(1) })
            : t('expense.form.splitPctOver', { x: (totalPct - 100).toFixed(1) }),
      };
    }
    const splits = percents.map((pct, i) => ({
      userId: members[i].id,
      owedCents: Math.round((amountCents * pct) / 100),
    }));
    const sum = splits.reduce((acc, s) => acc + s.owedCents, 0);
    if (splits.length > 0) splits[splits.length - 1].owedCents += amountCents - sum;
    return splits;
  }

  const shares = members.map((m) => parseInt(splitInputs[m.id] ?? '1') || 1);
  const totalShares = shares.reduce((a, b) => a + b, 0);
  const splits = shares.map((s, i) => ({
    userId: members[i].id,
    owedCents: Math.round((amountCents * s) / totalShares),
  }));
  const sum = splits.reduce((acc, s) => acc + s.owedCents, 0);
  if (splits.length > 0) splits[splits.length - 1].owedCents += amountCents - sum;
  return splits;
}

export function AddExpenseForm({
  group,
  submitting,
  submitError,
  onCancel,
  onSubmit,
  title,
  subtitle,
  defaults,
}: AddExpenseFormProps) {
  const { t } = useLanguage();
  const today = new Date().toISOString().slice(0, 10);

  const [description, setDescription] = useState(defaults?.description ?? '');
  const [amountInput, setAmountInput] = useState(
    defaults ? (defaults.amountCents / 100).toFixed(2) : '',
  );
  const [payerId, setPayerId] = useState<string>(
    defaults?.paidByUserId ?? group.members[0]?.id ?? '',
  );
  const [splitMode, setSplitMode] = useState<SplitMode>(defaults?.splitMode ?? 'equal');
  const [date, setDate] = useState(defaults?.date ?? today);
  const [participants, setParticipants] = useState<Set<string>>(() =>
    initParticipants(defaults?.splits, group.members),
  );
  const [splitInputs, setSplitInputs] = useState<Record<string, string>>(
    defaults
      ? initSplitInputs(defaults.splitMode, group.members, defaults.splits, defaults.amountCents)
      : {},
  );
  const [splitError, setSplitError] = useState<string | null>(null);

  const participantMembers = group.members.filter((m) => participants.has(m.id));

  const handleParticipantToggle = (memberId: string) => {
    const next = new Set(participants);
    if (next.has(memberId)) {
      next.delete(memberId);
    } else {
      next.add(memberId);
    }
    setParticipants(next);
    setSplitError(null);

    if (splitMode !== 'equal') {
      setSplitInputs((prev) => {
        const updated = { ...prev };
        if (!next.has(memberId)) {
          delete updated[memberId];
        } else if (!(memberId in updated)) {
          if (splitMode === 'exact') updated[memberId] = '0.00';
          else if (splitMode === 'percent') updated[memberId] = '0.0';
          else updated[memberId] = '1';
        }
        return updated;
      });
    }
  };

  const handleSplitModeChange = (newMode: SplitMode) => {
    setSplitMode(newMode);
    setSplitError(null);
    setSplitInputs(prefillSplitInputs(newMode, participantMembers, parseEurosToCents(amountInput)));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const amountCents = parseEurosToCents(amountInput);
    if (!description.trim() || amountCents <= 0 || !payerId || participants.size === 0) return;

    let exactSplits: { userId: string; owedCents: number }[] | undefined;

    if (splitMode === 'equal' && participants.size < group.members.length) {
      const n = participantMembers.length;
      const base = Math.floor(amountCents / n);
      const rem = amountCents - base * n;
      exactSplits = participantMembers.map((m, i) => ({
        userId: m.id,
        owedCents: base + (i === n - 1 ? rem : 0),
      }));
    } else if (splitMode !== 'equal') {
      const result = computeExactSplits(splitMode, participantMembers, splitInputs, amountCents, t);
      if ('error' in result) {
        setSplitError(result.error);
        return;
      }
      exactSplits = result;
    }

    setSplitError(null);
    onSubmit({
      groupId: group.id,
      description: description.trim(),
      amountCents,
      paidByUserId: payerId,
      date,
      splitMode,
      exactSplits,
    });
  };

  const parsedAmountCents = parseEurosToCents(amountInput);
  const resolvedTitle = title ?? t('expense.form.title');
  const resolvedSubtitle = subtitle ?? t('expense.form.subtitle', { group: group.name });

  return (
    <>
      <header className="site-header">
        <div className="header-content">
          <Link to={`/groups/${group.id}`} className="brand">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            {t('expense.form.backToGroup')}
          </Link>
        </div>
      </header>

      <main className="main-content max-w-[600px]">
        <header className="mb-8">
          <h1 className="text-h1">{resolvedTitle}</h1>
          <p className="text-muted-foreground">{resolvedSubtitle}</p>
        </header>

        {submitError && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{submitError}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="expense-desc">{t('expense.form.descLabel')}</Label>
                  <Input
                    type="text"
                    id="expense-desc"
                    name="description"
                    placeholder={t('expense.form.descPlaceholder')}
                    required
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expense-amount">{t('expense.form.amountLabel')}</Label>
                  <div className="input-prefix-wrapper">
                    <span className="input-prefix">€</span>
                    <Input
                      type="number"
                      id="expense-amount"
                      name="amount"
                      className="pl-8"
                      placeholder="0.00"
                      step="0.01"
                      min="0"
                      required
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="expense-payer">{t('expense.form.payerLabel')}</Label>
                  <select
                    id="expense-payer"
                    name="payer"
                    className="form-control"
                    required
                    value={payerId}
                    onChange={(e) => setPayerId(e.target.value)}
                  >
                    {group.members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.email ? `${m.name} (${m.email})` : m.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <Label>{t('expense.form.participantsLabel')}</Label>
                  <div className="flex flex-wrap gap-2">
                    {group.members.map((m) => {
                      const active = participants.has(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => handleParticipantToggle(m.id)}
                          className={cn(
                            'px-3 py-1 rounded-full text-sm font-medium border transition-colors',
                            active
                              ? 'bg-primary/10 border-primary/40 text-primary'
                              : 'bg-muted border-transparent text-muted-foreground opacity-50',
                          )}
                        >
                          {active && (
                            <span className="mr-1 text-xs" aria-hidden>
                              ✓
                            </span>
                          )}
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                  {participants.size === 0 && (
                    <p className="text-sm text-destructive">
                      {t('expense.form.participantsError')}
                    </p>
                  )}
                </div>

                <SplitModeToggle
                  mode={splitMode}
                  members={participantMembers}
                  amountCents={parsedAmountCents}
                  splitInputs={splitInputs}
                  onChange={handleSplitModeChange}
                  onSplitInputsChange={setSplitInputs}
                />

                {splitError && (
                  <Alert variant="destructive">
                    <AlertDescription>{splitError}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <Label htmlFor="expense-date">{t('expense.form.dateLabel')}</Label>
                  <Input
                    type="date"
                    id="expense-date"
                    name="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-actions">
                <Button
                  type="submit"
                  className="flex-1"
                  disabled={submitting || participants.size === 0}
                >
                  {submitting ? t('expense.form.saving') : t('expense.form.save')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={onCancel}
                  disabled={submitting}
                >
                  {t('expense.form.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
