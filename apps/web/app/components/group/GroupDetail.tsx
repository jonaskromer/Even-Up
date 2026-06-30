import { useState } from 'react';
import { Link } from 'react-router';
import { Balance, Expense, Group, PendingInvite } from '../../types';
import { ExpenseFeed } from './ExpenseFeed';
import { BalancesPanel } from './BalancesPanel';
import { SettleUpPanel } from './SettleUpPanel';
import { MembersPanel } from './MembersPanel';
import { ImportExpensesButton } from './ImportExpensesButton';
import { ActivityLog } from './ActivityLog';
import { Button } from '../ui/button';
import { PendingInvitationsBell } from '../layout/PendingInvitationsBell';
import { useLanguage } from '../../context/LanguageContext';

interface ActivityEntry {
  id: string;
  type: string;
  actorName: string;
  data: Record<string, unknown>;
  createdAt: string;
}

interface PerCurrencyBalance {
  currency: string;
  balances: Balance[];
}

interface GroupDetailProps {
  group: Group;
  expenses: Expense[];
  expensesTotal: number;
  balances: { userId: string; name: string; netCents: number }[];
  activities: ActivityEntry[];
  activitiesTotal: number;
  pendingInvites: PendingInvite[];
  onRevalidate: () => void;
}

function computePerCurrencyBalances(
  expenses: Expense[],
  memberIds: string[],
  memberMap: Record<string, string>,
): PerCurrencyBalance[] {
  const byCurrency = new Map<string, Map<string, number>>();

  for (const exp of expenses) {
    const cur = exp.originalCurrency;
    if (!byCurrency.has(cur)) {
      const net = new Map<string, number>();
      memberIds.forEach((id) => net.set(id, 0));
      byCurrency.set(cur, net);
    }
    const net = byCurrency.get(cur)!;

    // Payer gets credit in the expense's original currency
    net.set(exp.paidByUserId, (net.get(exp.paidByUserId) ?? 0) + exp.originalAmountCents);

    // Each split is proportional: ratio of their converted owedCents to total converted amountCents
    if (exp.splits && exp.amountCents > 0) {
      for (const split of exp.splits) {
        const ratio = split.owedCents / exp.amountCents;
        const originalOwed = Math.round(ratio * exp.originalAmountCents);
        net.set(split.userId, (net.get(split.userId) ?? 0) - originalOwed);
      }
    }
  }

  return Array.from(byCurrency.entries()).map(([currency, net]) => ({
    currency,
    balances: memberIds.map((id) => ({
      userId: id,
      name: memberMap[id] ?? id,
      netCents: net.get(id) ?? 0,
    })),
  }));
}

export function GroupDetail({
  group,
  expenses,
  expensesTotal,
  balances,
  activities,
  activitiesTotal,
  pendingInvites,
  onRevalidate,
}: GroupDetailProps) {
  const { t } = useLanguage();
  const [showConverted, setShowConverted] = useState(true);

  const groupExpenses = expenses.filter((e) => e.groupId === group.id);
  const memberEmailMap = Object.fromEntries(group.members.map((m) => [m.id, m.email]));
  const memberNameMap = Object.fromEntries(group.members.map((m) => [m.id, m.name]));
  const balancesWithEmail: Balance[] = balances.map((b) => ({
    ...b,
    email: memberEmailMap[b.userId],
  }));

  const perCurrencyBalances = showConverted
    ? []
    : computePerCurrencyBalances(
        groupExpenses,
        group.members.map((m) => m.id),
        memberNameMap,
      );

  const hasMixedCurrencies = groupExpenses.some((e) => e.originalCurrency !== group.currency);

  return (
    <>
      <header className="site-header">
        <div className="header-content">
          <Link to="/" className="brand">
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
            {t('common.overview')}
          </Link>
          <nav className="user-nav">
            <PendingInvitationsBell />
            <ImportExpensesButton group={group} onImported={onRevalidate} />
            <Link to={`/groups/${group.id}/new-expense`}>
              <Button size="sm">
                <span className="hidden sm:inline">{t('group.addExpense')}</span>
                <span className="sm:hidden" aria-label={t('group.addExpense')}>
                  {t('group.addExpenseShort')}
                </span>
              </Button>
            </Link>
          </nav>
        </div>
      </header>

      <main className="main-content">
        <header className="mb-8">
          <h1 className="text-h1 mb-1">{group.name}</h1>
          <p className="text-muted-foreground">
            {t('group.subtitle', { members: group.members.length, expenses: groupExpenses.length })}
          </p>
        </header>

        {hasMixedCurrencies && (
          <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-muted/50 border border-border">
            <button
              type="button"
              role="switch"
              aria-checked={showConverted}
              onClick={() => setShowConverted((v) => !v)}
              className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                showConverted ? 'bg-primary' : 'bg-muted-foreground/40'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-lg transform transition-transform ${
                  showConverted ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="text-sm text-muted-foreground">
              {showConverted
                ? t('group.convertToggle.on', { currency: group.currency })
                : t('group.convertToggle.off')}
            </span>
          </div>
        )}

        <div className="grid-2">
          <ExpenseFeed
            key={`ef-${expensesTotal}-${groupExpenses[0]?.id ?? ''}`}
            group={group}
            initialExpenses={groupExpenses}
            total={expensesTotal}
            showConverted={showConverted}
            onExpenseDeleted={onRevalidate}
          />
          <aside className="space-y-6">
            <BalancesPanel
              balances={balancesWithEmail}
              groupCurrency={group.currency}
              showConverted={showConverted}
              perCurrencyBalances={perCurrencyBalances}
            />
            <SettleUpPanel groupId={group.id} members={group.members} onSettled={onRevalidate} />
            <MembersPanel
              groupId={group.id}
              members={group.members}
              pendingInvites={pendingInvites}
              onMemberAdded={onRevalidate}
            />
            <ActivityLog
              key={`al-${activitiesTotal}-${activities[0]?.id ?? ''}`}
              groupId={group.id}
              initialActivities={activities}
              total={activitiesTotal}
            />
          </aside>
        </div>
      </main>
    </>
  );
}
