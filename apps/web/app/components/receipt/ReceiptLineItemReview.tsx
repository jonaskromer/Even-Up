import { useMemo, type ReactNode } from 'react';
import { Member, ReceiptDraftLineItem, SplitMode } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { formatCurrency, cn } from '../../lib/utils';
import { computeReceiptSplits, isItemSplitValid, receiptTotalCents } from '../../lib/receiptSplits';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Card, CardContent } from '../ui/card';

interface ReceiptLineItemReviewProps {
  storeName: string;
  onStoreNameChange: (v: string) => void;
  lineItems: ReceiptDraftLineItem[];
  onLineItemsChange: (items: ReceiptDraftLineItem[]) => void;
  members: Member[];
  currency: string;
  onContinue: () => void;
  onCancel: () => void;
}

// Prefills a sensible default per assignee when a line item's split mode changes,
// mirroring AddExpenseForm's prefillSplitInputs — otherwise switching to 'exact'/
// 'percent' would start from a nonsensical all-zero state that reads as broken.
function prefillForMode(
  mode: SplitMode,
  assignments: ReceiptDraftLineItem['assignments'],
  priceCents: number,
): ReceiptDraftLineItem['assignments'] {
  const n = assignments.length;
  if (n === 0) return assignments;
  if (mode === 'exact') {
    const share = Math.round(priceCents / n);
    return assignments.map((a) => ({ ...a, exactCents: share }));
  }
  if (mode === 'percent') {
    const share = Math.round((100 / n) * 10) / 10;
    return assignments.map((a) => ({ ...a, percent: share }));
  }
  if (mode === 'shares') {
    return assignments.map((a) => ({ ...a, weight: 1 }));
  }
  return assignments;
}

export function ReceiptLineItemReview({
  storeName,
  onStoreNameChange,
  lineItems,
  onLineItemsChange,
  members,
  currency,
  onContinue,
  onCancel,
}: ReceiptLineItemReviewProps) {
  const { t } = useLanguage();

  function updateItem(index: number, patch: Partial<ReceiptDraftLineItem>) {
    onLineItemsChange(lineItems.map((li, i) => (i === index ? { ...li, ...patch } : li)));
  }

  function toggleAssignment(index: number, userId: string) {
    const item = lineItems[index];
    const has = item.assignments.some((a) => a.userId === userId);
    const assignments = has
      ? item.assignments.filter((a) => a.userId !== userId)
      : [
          ...item.assignments,
          {
            userId,
            weight: 1,
            exactCents: item.splitMode === 'exact' ? 0 : undefined,
            percent: item.splitMode === 'percent' ? 0 : undefined,
          },
        ];
    updateItem(index, { assignments });
  }

  function handleSplitModeChange(index: number, mode: SplitMode) {
    const item = lineItems[index];
    updateItem(index, {
      splitMode: mode,
      assignments: prefillForMode(mode, item.assignments, item.priceCents),
    });
  }

  function adjustWeight(index: number, userId: string, delta: number) {
    const item = lineItems[index];
    const assignments = item.assignments.map((a) =>
      a.userId === userId ? { ...a, weight: Math.max(1, a.weight + delta) } : a,
    );
    updateItem(index, { assignments });
  }

  function updateExactCents(index: number, userId: string, euros: string) {
    const item = lineItems[index];
    const value = Number.parseFloat(euros.replace(',', '.'));
    const cents = Number.isNaN(value) ? 0 : Math.round(value * 100);
    const assignments = item.assignments.map((a) =>
      a.userId === userId ? { ...a, exactCents: cents } : a,
    );
    updateItem(index, { assignments });
  }

  function updatePercent(index: number, userId: string, raw: string) {
    const item = lineItems[index];
    const value = Number.parseFloat(raw.replace(',', '.'));
    const percent = Number.isNaN(value) ? 0 : value;
    const assignments = item.assignments.map((a) => (a.userId === userId ? { ...a, percent } : a));
    updateItem(index, { assignments });
  }

  function toggleExcluded(index: number) {
    updateItem(index, { excluded: !lineItems[index].excluded });
  }

  function itemFeedback(item: ReceiptDraftLineItem): ReactNode {
    if (item.splitMode === 'exact') {
      const sum = item.assignments.reduce((s, a) => s + (a.exactCents ?? 0), 0);
      const remaining = item.priceCents - sum;
      if (remaining === 0) return null;
      return remaining > 0
        ? t('expense.splitMode.feedbackExactRemaining', { amount: (remaining / 100).toFixed(2) })
        : t('expense.splitMode.feedbackExactOver', {
            amount: (Math.abs(remaining) / 100).toFixed(2),
          });
    }
    if (item.splitMode === 'percent') {
      const totalPct = item.assignments.reduce((s, a) => s + (a.percent ?? 0), 0);
      const remaining = 100 - totalPct;
      if (Math.abs(remaining) < 0.05) return null;
      return remaining > 0
        ? t('expense.splitMode.feedbackPctRemaining', { x: remaining.toFixed(1) })
        : t('expense.splitMode.feedbackPctOver', { x: Math.abs(remaining).toFixed(1) });
    }
    return null;
  }

  const memberTotals = useMemo(() => computeReceiptSplits(lineItems), [lineItems]);
  const totalCents = useMemo(() => receiptTotalCents(lineItems), [lineItems]);
  const allItemsValid = lineItems.every(isItemSplitValid);
  const canContinue = totalCents > 0 && memberTotals.length > 0 && allItemsValid;

  return (
    <main className="main-content max-w-[640px]">
      <header className="mb-6">
        <h1 className="text-h1">{t('receipt.reviewTitle')}</h1>
      </header>

      <div className="space-y-2 mb-6">
        <Label htmlFor="receipt-store-name">{t('receipt.storeNameLabel')}</Label>
        <Input
          id="receipt-store-name"
          value={storeName}
          onChange={(e) => onStoreNameChange(e.target.value)}
        />
      </div>

      <h2 className="text-sm font-semibold text-muted-foreground mb-3">
        {t('receipt.itemsTitle')}
      </h2>
      <div className="space-y-3 mb-6">
        {lineItems.map((item, i) => (
          <Card key={i} className={cn(item.excluded && 'opacity-40')}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className={cn('font-medium', item.excluded && 'line-through')}>
                    {item.name}
                    {item.quantity !== 1 && (
                      <span className="text-muted-foreground font-normal ml-1 text-sm">
                        {t('receipt.itemQuantity', { n: item.quantity })}
                      </span>
                    )}
                  </p>
                  {item.excluded && (
                    <p className="text-xs text-muted-foreground">{t('receipt.excludedHint')}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('font-mono tabular-nums', item.excluded && 'line-through')}>
                    {formatCurrency(item.priceCents, currency)}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t('receipt.excludeItem')}
                    aria-pressed={item.excluded}
                    onClick={() => toggleExcluded(i)}
                  >
                    {item.excluded ? '↺' : '✕'}
                  </Button>
                </div>
              </div>

              {!item.excluded && (
                <>
                  <div className="flex flex-wrap gap-2">
                    {members.map((m) => {
                      const active = item.assignments.some((a) => a.userId === m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => toggleAssignment(i, m.id)}
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

                  {item.assignments.length > 0 && (
                    <div className="space-y-2 pt-1">
                      <select
                        aria-label={t('receipt.splitModeLabel')}
                        className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                        value={item.splitMode}
                        onChange={(e) => handleSplitModeChange(i, e.target.value as SplitMode)}
                      >
                        <option value="equal">
                          {t('expense.splitMode.equal', { n: item.assignments.length })}
                        </option>
                        <option value="exact">{t('expense.splitMode.exact')}</option>
                        <option value="percent">{t('expense.splitMode.percent')}</option>
                        <option value="shares">{t('expense.splitMode.shares')}</option>
                      </select>

                      {item.splitMode === 'shares' && (
                        <div className="space-y-1">
                          {item.assignments.map((a) => {
                            const member = members.find((m) => m.id === a.userId);
                            return (
                              <div key={a.userId} className="flex items-center gap-2 text-sm">
                                <span className="flex-1 truncate">{member?.name ?? a.userId}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => adjustWeight(i, a.userId, -1)}
                                >
                                  −
                                </Button>
                                <span className="w-4 text-center tabular-nums">{a.weight}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="icon"
                                  className="h-6 w-6"
                                  onClick={() => adjustWeight(i, a.userId, 1)}
                                >
                                  +
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {item.splitMode === 'exact' && (
                        <div className="space-y-1">
                          {item.assignments.map((a) => {
                            const member = members.find((m) => m.id === a.userId);
                            return (
                              <div key={a.userId} className="flex items-center gap-2 text-sm">
                                <span className="flex-1 truncate">{member?.name ?? a.userId}</span>
                                <span className="text-muted-foreground text-xs">€</span>
                                <Input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="w-24 h-8 text-sm"
                                  value={((a.exactCents ?? 0) / 100).toFixed(2)}
                                  onChange={(e) => updateExactCents(i, a.userId, e.target.value)}
                                />
                              </div>
                            );
                          })}
                          {itemFeedback(item) && (
                            <p className="text-xs text-muted-foreground">{itemFeedback(item)}</p>
                          )}
                        </div>
                      )}

                      {item.splitMode === 'percent' && (
                        <div className="space-y-1">
                          {item.assignments.map((a) => {
                            const member = members.find((m) => m.id === a.userId);
                            return (
                              <div key={a.userId} className="flex items-center gap-2 text-sm">
                                <span className="flex-1 truncate">{member?.name ?? a.userId}</span>
                                <Input
                                  type="number"
                                  step="0.1"
                                  min="0"
                                  max="100"
                                  className="w-24 h-8 text-sm"
                                  value={a.percent ?? 0}
                                  onChange={(e) => updatePercent(i, a.userId, e.target.value)}
                                />
                                <span className="text-muted-foreground text-xs">%</span>
                              </div>
                            );
                          })}
                          {itemFeedback(item) && (
                            <p className="text-xs text-muted-foreground">{itemFeedback(item)}</p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="mb-6">
        <CardContent className="pt-4">
          <h2 className="text-sm font-semibold text-muted-foreground mb-2">
            {t('receipt.memberTotalsTitle')}
          </h2>
          <div className="space-y-1">
            {members.map((m) => {
              const total = memberTotals.find((s) => s.userId === m.id)?.owedCents ?? 0;
              if (total === 0) return null;
              return (
                <div key={m.id} className="flex justify-between text-sm">
                  <span>{m.name}</span>
                  <span className="font-mono tabular-nums">{formatCurrency(total, currency)}</span>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {!canContinue && (
        <p className="text-sm text-destructive mb-4">{t('receipt.noAmountError')}</p>
      )}

      <div className="form-actions">
        <Button className="flex-1" disabled={!canContinue} onClick={onContinue}>
          {t('receipt.continueButton')}
        </Button>
        <Button className="flex-1" variant="outline" onClick={onCancel}>
          {t('receipt.cancel')}
        </Button>
      </div>
    </main>
  );
}
