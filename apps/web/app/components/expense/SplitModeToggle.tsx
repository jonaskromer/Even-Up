import type { ReactNode } from 'react';
import { SplitMode, Member } from '../../types';
import { useLanguage } from '../../context/LanguageContext';
import { Label } from '../ui/label';
import { Input } from '../ui/input';

interface SplitModeToggleProps {
  mode: SplitMode;
  members: Member[];
  amountCents: number;
  splitInputs: Record<string, string>;
  onChange: (mode: SplitMode) => void;
  onSplitInputsChange: (inputs: Record<string, string>) => void;
}

export function SplitModeToggle({
  mode,
  members,
  amountCents,
  splitInputs,
  onChange,
  onSplitInputsChange,
}: SplitModeToggleProps) {
  const { t } = useLanguage();

  const handleMemberInput = (userId: string, value: string) => {
    onSplitInputsChange({ ...splitInputs, [userId]: value });
  };

  let feedbackNode: ReactNode = null;

  if (mode === 'exact') {
    const totalEntered = members.reduce((sum, m) => {
      const raw = (splitInputs[m.id] ?? '0').replace(',', '.');
      const val = parseFloat(raw);
      return sum + (isNaN(val) ? 0 : Math.round(val * 100));
    }, 0);
    const remainingCents = amountCents - totalEntered;
    const valid = remainingCents === 0 && amountCents > 0;
    feedbackNode = (
      <span className={valid ? 'text-green-600' : 'text-muted-foreground'}>
        {valid
          ? t('expense.splitMode.feedbackComplete')
          : remainingCents > 0
            ? t('expense.splitMode.feedbackExactRemaining', {
                amount: (remainingCents / 100).toFixed(2),
              })
            : t('expense.splitMode.feedbackExactOver', {
                amount: (Math.abs(remainingCents) / 100).toFixed(2),
              })}
      </span>
    );
  } else if (mode === 'percent') {
    const totalPct = members.reduce((sum, m) => {
      const val = parseFloat((splitInputs[m.id] ?? '0').replace(',', '.'));
      return sum + (isNaN(val) ? 0 : val);
    }, 0);
    const remaining = 100 - totalPct;
    const valid = Math.abs(remaining) < 0.05;
    feedbackNode = (
      <span className={valid ? 'text-green-600' : 'text-muted-foreground'}>
        {valid
          ? t('expense.splitMode.feedbackCompletePercent')
          : remaining > 0
            ? t('expense.splitMode.feedbackPctRemaining', { x: remaining.toFixed(1) })
            : t('expense.splitMode.feedbackPctOver', { x: Math.abs(remaining).toFixed(1) })}
      </span>
    );
  } else if (mode === 'shares') {
    const totalShares = members.reduce((sum, m) => {
      const val = parseInt(splitInputs[m.id] ?? '1') || 1;
      return sum + val;
    }, 0);
    feedbackNode = (
      <span className="text-muted-foreground">
        {t('expense.splitMode.feedbackShares', { n: totalShares })}
      </span>
    );
  }

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <Label htmlFor="expense-split">{t('expense.splitMode.label')}</Label>
        <select
          id="expense-split"
          name="split"
          className="form-control"
          required
          value={mode}
          onChange={(e) => onChange(e.target.value as SplitMode)}
        >
          <option value="equal">{t('expense.splitMode.equal', { n: members.length })}</option>
          <option value="exact">{t('expense.splitMode.exact')}</option>
          <option value="percent">{t('expense.splitMode.percent')}</option>
          <option value="shares">{t('expense.splitMode.shares')}</option>
        </select>
      </div>

      {mode !== 'equal' && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          {members.map((member) => {
            let suffix: ReactNode = null;
            if (mode === 'shares' && amountCents > 0) {
              const totalShares = members.reduce((sum, m) => {
                return sum + (parseInt(splitInputs[m.id] ?? '1') || 1);
              }, 0);
              const memberShares = parseInt(splitInputs[member.id] ?? '1') || 1;
              const computed = (
                Math.round((amountCents * memberShares) / totalShares) / 100
              ).toFixed(2);
              suffix = (
                <span className="text-sm text-muted-foreground w-20 text-right shrink-0">
                  = {computed} €
                </span>
              );
            }

            return (
              <div key={member.id} className="flex items-center gap-2">
                <span className="flex-1 text-sm truncate">{member.name}</span>
                {mode === 'exact' && (
                  <span className="text-sm text-muted-foreground shrink-0">€</span>
                )}
                <Input
                  type="number"
                  className="w-24 h-8 text-sm"
                  placeholder={mode === 'shares' ? '1' : mode === 'percent' ? '0' : '0.00'}
                  step={mode === 'exact' ? '0.01' : mode === 'percent' ? '0.1' : '1'}
                  min="0"
                  value={splitInputs[member.id] ?? ''}
                  onChange={(e) => handleMemberInput(member.id, e.target.value)}
                />
                {mode === 'percent' && (
                  <span className="text-sm text-muted-foreground shrink-0">%</span>
                )}
                {suffix}
              </div>
            );
          })}

          <div className="pt-1 border-t border-border text-sm">{feedbackNode}</div>
        </div>
      )}
    </div>
  );
}
