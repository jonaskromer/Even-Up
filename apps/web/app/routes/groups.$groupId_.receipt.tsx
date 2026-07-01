import { useState } from 'react';
import { useNavigate } from 'react-router';
import type { Route } from './+types/groups.$groupId_.receipt';
import { requireAuth } from '../lib/requireAuth';
import { useLanguage } from '../context/LanguageContext';
import { api, ApiError, postFileStream } from '../lib/apiClient';
import { AddExpenseForm } from '../components/expense/AddExpenseForm';
import { ReceiptUploadStep } from '../components/receipt/ReceiptUploadStep';
import { ReceiptProcessingStep } from '../components/receipt/ReceiptProcessingStep';
import { ReceiptLineItemReview } from '../components/receipt/ReceiptLineItemReview';
import { computeReceiptSplits, receiptTotalCents } from '../lib/receiptSplits';
import type {
  Expense,
  Group,
  NewExpenseInput,
  ParsedReceipt,
  ReceiptDraftLineItem,
  ReceiptParseProgress,
} from '../types';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export async function clientLoader({ params, request }: Route.ClientLoaderArgs) {
  // Use the loader's own request URL, not window.location — the browser's address bar
  // hasn't necessarily updated to the destination URL yet while the loader is running,
  // so window.location.search could still reflect the *previous* page and silently
  // drop the expenseId param, sending the user to the upload screen instead of review.
  const expenseId = new URL(request.url).searchParams.get('expenseId');
  const [user, group, expense] = await Promise.all([
    requireAuth(),
    api.get<Group>(`/api/groups/${params.groupId}`),
    expenseId
      ? api.get<Expense>(`/api/groups/${params.groupId}/expenses/${expenseId}`)
      : Promise.resolve(null),
  ]);
  return { group, expense, defaultMarkupRate: user.defaultMarkupRate };
}

interface ReceiptDefaults {
  description: string;
  amountCents: number;
  paidByUserId: string;
  splitMode: 'exact';
  date: string;
  splits: { userId: string; owedCents: number }[];
}

type Screen =
  | { step: 'upload' }
  | { step: 'processing' }
  | { step: 'review'; storeName: string; date: string; lineItems: ReceiptDraftLineItem[] }
  | {
      step: 'confirm';
      storeName: string;
      lineItems: ReceiptDraftLineItem[];
      defaults: ReceiptDefaults;
    };

function receiptLineItemsFromExpense(expense: Expense): ReceiptDraftLineItem[] {
  return (expense.lineItems ?? []).map((li) => ({
    name: li.name,
    quantity: li.quantity,
    priceCents: li.priceCents,
    excluded: li.excluded,
    splitMode: li.splitMode,
    assignments: li.assignments.map((a) => ({
      userId: a.userId,
      weight: a.weight,
      exactCents: a.exactCents,
      percent: a.percent,
    })),
  }));
}

export default function ReceiptRoute({ loaderData }: Route.ComponentProps) {
  const { group, expense, defaultMarkupRate } = loaderData;
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [screen, setScreen] = useState<Screen>(() =>
    expense && expense.lineItems && expense.lineItems.length > 0
      ? {
          step: 'review',
          storeName: expense.receiptStoreName ?? expense.description,
          date: expense.date,
          lineItems: receiptLineItemsFromExpense(expense),
        }
      : { step: 'upload' },
  );
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [parseProgress, setParseProgress] = useState<ReceiptParseProgress | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function backToGroup() {
    navigate(`/groups/${group.id}`);
  }

  async function handleFileSelected(file: File) {
    setUploadError(null);
    setParseProgress(null);
    setScreen({ step: 'processing' });
    try {
      const formData = new FormData();
      formData.append('file', file);
      const parsed = await postFileStream<ReceiptParseProgress, ParsedReceipt>(
        `/api/groups/${group.id}/receipts/parse`,
        formData,
        setParseProgress,
      );
      setScreen({
        step: 'review',
        storeName: parsed.storeName,
        date: parsed.date ?? todayIso(),
        lineItems: parsed.lineItems.map((li) => ({
          name: li.name,
          quantity: li.quantity,
          priceCents: li.priceCents,
          excluded: false,
          splitMode: 'shares' as const,
          assignments: group.members.map((m) => ({ userId: m.id, weight: 1 })),
        })),
      });
    } catch (err) {
      const msg = err instanceof ApiError ? err.message : t('receipt.parseError');
      setUploadError(`${msg} ${t('receipt.parseErrorHint')}`);
      setScreen({ step: 'upload' });
    }
  }

  function handleContinue() {
    if (screen.step !== 'review') return;
    const splits = computeReceiptSplits(screen.lineItems);
    const amountCents = receiptTotalCents(screen.lineItems);
    setScreen({
      step: 'confirm',
      storeName: screen.storeName,
      lineItems: screen.lineItems,
      defaults: {
        description: screen.storeName,
        amountCents,
        paidByUserId: expense?.paidByUserId ?? group.members[0]?.id ?? '',
        splitMode: 'exact',
        date: screen.date,
        splits,
      },
    });
  }

  async function handleFinalSubmit(input: NewExpenseInput) {
    if (screen.step !== 'confirm') return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const body = {
        storeName: screen.storeName,
        paidByUserId: input.paidByUserId,
        date: input.date,
        currency: input.currency,
        markupRate: input.markupRate,
        lineItems: screen.lineItems,
      };
      if (expense) {
        await api.put(`/api/groups/${group.id}/receipts/${expense.id}`, {
          ...body,
          updatedAt: expense.updatedAt,
        });
      } else {
        await api.post(`/api/groups/${group.id}/receipts`, body);
      }
      backToGroup();
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
  }

  if (screen.step === 'upload') {
    return (
      <ReceiptUploadStep
        onFileSelected={(file) => void handleFileSelected(file)}
        onManualEntry={() => navigate(`/groups/${group.id}/new-expense`)}
        onCancel={backToGroup}
        error={uploadError}
      />
    );
  }

  if (screen.step === 'processing') {
    return <ReceiptProcessingStep progress={parseProgress} />;
  }

  if (screen.step === 'review') {
    const currentScreen = screen;
    return (
      <ReceiptLineItemReview
        storeName={currentScreen.storeName}
        onStoreNameChange={(v) => setScreen({ ...currentScreen, storeName: v })}
        lineItems={currentScreen.lineItems}
        onLineItemsChange={(items) => setScreen({ ...currentScreen, lineItems: items })}
        members={group.members}
        currency={group.currency}
        onContinue={handleContinue}
        onCancel={backToGroup}
      />
    );
  }

  return (
    <AddExpenseForm
      group={group}
      submitting={submitting}
      submitError={submitError}
      onCancel={() =>
        setScreen({
          step: 'review',
          storeName: screen.storeName,
          date: screen.defaults.date,
          lineItems: screen.lineItems,
        })
      }
      onSubmit={(input) => void handleFinalSubmit(input)}
      defaults={screen.defaults}
      defaultMarkupRate={defaultMarkupRate}
    />
  );
}
