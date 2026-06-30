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
  const groupExpenses = expenses.filter((e) => e.groupId === group.id);
  const memberEmailMap = Object.fromEntries(group.members.map((m) => [m.id, m.email]));
  const balancesWithEmail: Balance[] = balances.map((b) => ({
    ...b,
    email: memberEmailMap[b.userId],
  }));

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

        <div className="grid-2">
          <ExpenseFeed
            key={`ef-${expensesTotal}-${groupExpenses[0]?.id ?? ''}`}
            group={group}
            initialExpenses={groupExpenses}
            total={expensesTotal}
            onExpenseDeleted={onRevalidate}
          />
          <aside className="space-y-6">
            <BalancesPanel balances={balancesWithEmail} />
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
