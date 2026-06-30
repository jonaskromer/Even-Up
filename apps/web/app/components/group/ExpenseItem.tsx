import { useState } from 'react';
import { Link } from 'react-router';
import { Expense, Group } from '../../types';
import { formatEuro } from '../../lib/computeBalances';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../lib/apiClient';
import { Button } from '../ui/button';

interface ExpenseItemProps {
  expense: Expense;
  group: Group;
  onDeleted: () => void;
}

export function ExpenseItem({ expense, group, onDeleted }: ExpenseItemProps) {
  const { user } = useAuth();
  const { t, lang } = useLanguage();
  const currentUserId = user?.id ?? '';
  const [deleting, setDeleting] = useState(false);

  const payer = group.members.find((m) => m.id === expense.paidByUserId);
  const payerLabel =
    expense.paidByUserId === currentUserId
      ? t('expense.item.youPaid')
      : t('expense.item.paidBy', {
          name: expense.paidByName ?? payer?.name ?? t('common.unknown'),
        });

  const share = Math.round(expense.amountCents / group.members.length);
  const youPaid = expense.paidByUserId === currentUserId;
  const userShare = youPaid ? expense.amountCents - share : share;
  const cls = youPaid ? 'text-success' : 'text-danger';
  const shareLabel = youPaid
    ? t('expense.item.youGet', { amount: formatEuro(userShare) })
    : t('expense.item.youOwe', { amount: formatEuro(userShare) });

  const dateObj = new Date(expense.date);
  const month = dateObj.toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', { month: 'short' });
  const day = dateObj.getDate().toString();

  async function handleDelete() {
    if (!confirm(t('expense.item.deleteConfirm', { desc: expense.description }))) return;
    setDeleting(true);
    try {
      await api.delete(`/api/groups/${group.id}/expenses/${expense.id}`);
      onDeleted();
    } catch (err) {
      console.error('Delete failed:', err);
      setDeleting(false);
    }
  }

  return (
    <div className="expense-item group/item">
      <div className="expense-date">
        <span className="date-month">{month}</span>
        <span className="date-day">{day}</span>
      </div>
      <div className="expense-details">
        <h3 className="expense-title">{expense.description}</h3>
        <span className="expense-payer">{payerLabel}</span>
      </div>
      <div className={`expense-amount-box ${cls}`}>
        <span className="amount-total">{formatEuro(expense.amountCents)}</span>
        <span className="amount-share">{shareLabel}</span>
      </div>
      <div className="flex items-center opacity-40 hover:opacity-100 transition-opacity ml-2 shrink-0">
        <Link to={`/groups/${expense.groupId}/expenses/${expense.id}/edit`}>
          <Button variant="ghost" size="sm">
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
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </Button>
        </Link>
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
            <polyline points="3 6 5 6 21 6"></polyline>
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
          </svg>
        </Button>
      </div>
    </div>
  );
}
