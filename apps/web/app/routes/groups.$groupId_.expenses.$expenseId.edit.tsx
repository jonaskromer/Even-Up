import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Route } from './+types/groups.$groupId_.expenses.$expenseId.edit';
import { requireAuth } from '../lib/requireAuth';
import { useLanguage } from '../context/LanguageContext';
import { api, ApiError } from '../lib/apiClient';
import { AddExpenseForm } from '../components/expense/AddExpenseForm';
import type { Expense, Group, NewExpenseInput } from '../types';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireAuth();

  const [group, expense] = await Promise.all([
    api.get<Group>(`/api/groups/${params.groupId}`),
    api.get<Expense>(`/api/groups/${params.groupId}/expenses/${params.expenseId}`),
  ]);

  return { group, expense };
}

export default function EditExpenseRoute({ loaderData }: Route.ComponentProps) {
  const { group, expense } = loaderData;
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (input: NewExpenseInput) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.put<Expense>(`/api/groups/${group.id}/expenses/${expense.id}`, {
        description: input.description,
        amountCents: input.amountCents,
        currency: input.currency,
        paidByUserId: input.paidByUserId,
        date: input.date,
        splitMode: input.splitMode,
        exactSplits: input.exactSplits,
        updatedAt: expense.updatedAt,
      });
      navigate(`/groups/${group.id}`);
    } catch (err) {
      const msg =
        err instanceof ApiError && err.status === 409
          ? err.message
          : err instanceof ApiError
            ? `${t('expense.form.saveErrorPrefix')} (${err.status || t('expense.form.saveErrorNetwork')}): ${err.message}`
            : t('expense.form.saveErrorUnknown');
      setSubmitError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AddExpenseForm
      group={group}
      submitting={submitting}
      submitError={submitError}
      onCancel={() => navigate(`/groups/${group.id}`)}
      onSubmit={(input) => void handleSubmit(input)}
      title={t('expense.form.editTitle')}
      subtitle={t('expense.form.editSubtitle', {
        expense: expense.description,
        group: group.name,
      })}
      defaults={{
        description: expense.description,
        amountCents: expense.amountCents,
        originalAmountCents: expense.originalAmountCents,
        originalCurrency: expense.originalCurrency,
        paidByUserId: expense.paidByUserId,
        splitMode: expense.splitMode,
        date: expense.date,
        splits: expense.splits,
      }}
    />
  );
}
