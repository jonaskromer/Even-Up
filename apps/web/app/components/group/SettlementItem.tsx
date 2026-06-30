import { useState } from 'react';
import { Settlement, Group } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../lib/apiClient';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface SettlementItemProps {
  settlement: Settlement;
  group: Group;
  onChanged: () => void;
}

export function SettlementItem({ settlement, group, onChanged }: SettlementItemProps) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const currentUserId = user?.id ?? '';
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editAmount, setEditAmount] = useState((settlement.amountCents / 100).toFixed(2));
  const [editDate, setEditDate] = useState(settlement.date);
  const [editNote, setEditNote] = useState(settlement.note ?? '');

  const isFromMe = settlement.fromUserId === currentUserId;
  const isToMe = settlement.toUserId === currentUserId;

  const roleLabel = isFromMe
    ? t('settlement.item.paidTo', { name: settlement.toUserName })
    : isToMe
      ? t('settlement.item.receivedFrom', { name: settlement.fromUserName })
      : `${settlement.fromUserName} → ${settlement.toUserName}`;

  const dateObj = new Date(settlement.date);
  const month = dateObj.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { month: 'short' });
  const day = dateObj.getDate().toString();

  async function handleDelete() {
    const label = formatCurrency(settlement.amountCents, group.currency);
    if (!confirm(t('settlement.item.deleteConfirm', { amount: label }))) return;
    setDeleting(true);
    try {
      await api.delete(`/api/groups/${group.id}/settlements/${settlement.id}`);
      onChanged();
    } catch (err) {
      console.error('Delete failed:', err);
      setDeleting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      const amountCents = Math.round(parseFloat(editAmount.replace(',', '.')) * 100);
      await api.put(`/api/groups/${group.id}/settlements/${settlement.id}`, {
        fromUserId: settlement.fromUserId,
        toUserId: settlement.toUserId,
        amountCents,
        date: editDate,
        note: editNote || undefined,
      });
      setEditing(false);
      onChanged();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <div className="expense-item flex-col items-start gap-3 py-4">
        <p className="text-sm font-medium text-foreground">{t('settlement.item.editTitle')}</p>
        <div className="w-full space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t('settlement.item.amountLabel')}</Label>
            <Input
              type="number"
              step="0.01"
              min="0"
              value={editAmount}
              onChange={(e) => setEditAmount(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('settlement.item.dateLabel')}</Label>
            <Input
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t('settlement.item.noteLabel')}</Label>
            <Input
              type="text"
              value={editNote}
              onChange={(e) => setEditNote(e.target.value)}
              className="h-8 text-sm"
            />
          </div>
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? t('settlement.item.saving') : t('settlement.item.save')}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(false)} disabled={saving}>
              {t('settlement.item.cancel')}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="expense-item group/item">
      <div className="expense-date text-primary/60">
        <span className="date-month">{month}</span>
        <span className="date-day">{day}</span>
      </div>
      <div className="expense-details">
        <h3 className="expense-title flex items-center gap-1.5">
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary/70 shrink-0"
          >
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          {roleLabel}
        </h3>
        {settlement.note && <span className="expense-payer">{settlement.note}</span>}
        {!settlement.note && (
          <span className="expense-payer">
            {isFromMe
              ? t('settlement.item.youPaid')
              : isToMe
                ? t('settlement.item.youReceived')
                : ''}
          </span>
        )}
      </div>
      <div className="expense-amount-box text-primary">
        <span className="amount-total">
          {formatCurrency(settlement.amountCents, group.currency)}
        </span>
      </div>
      <div className="flex items-center opacity-40 hover:opacity-100 transition-opacity ml-2 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={handleDelete}
          disabled={deleting}
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </Button>
      </div>
    </div>
  );
}
