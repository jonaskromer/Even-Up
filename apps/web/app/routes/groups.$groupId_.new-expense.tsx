import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Route } from './+types/groups.$groupId_.new-expense';
import { requireAuth } from '../lib/requireAuth';
import { useLanguage } from '../context/LanguageContext';
import { api, ApiError } from '../lib/apiClient';
import { AddExpenseForm } from '../components/expense/AddExpenseForm';
import type { Expense, Group, NewExpenseInput } from '../types';

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireAuth();

  const group = await api.get<Group>(`/api/groups/${params.groupId}`);
  return { group };
}

export default function NewExpenseRoute({ loaderData }: Route.ComponentProps) {
  const { group } = loaderData;
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (input: NewExpenseInput) => {
    setSubmitting(true);
    setSubmitError(null);
    try {
      await api.post<Expense>(`/api/groups/${input.groupId}/expenses`, {
        description: input.description,
        amountCents: input.amountCents,
        currency: input.currency,
        paidByUserId: input.paidByUserId,
        date: input.date,
        splitMode: input.splitMode,
        exactSplits: input.exactSplits,
      });
      navigate(`/groups/${group.id}`);
    } catch (err) {
      const msg =
        err instanceof ApiError
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
    />
  );
}
