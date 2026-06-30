import { useRevalidator } from 'react-router';
import type { Route } from './+types/groups.$groupId';
import { requireAuth } from '../lib/requireAuth';
import { api } from '../lib/apiClient';
import { GroupDetail } from '../components/group/GroupDetail';
import type { Expense, Group, PendingInvite, Settlement } from '../types';

type ActivityEntry = {
  id: string;
  type: string;
  actorName: string;
  data: Record<string, unknown>;
  createdAt: string;
};

const PAGE_SIZE = 20;

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await requireAuth();

  const [group, expensesPage, balances, activitiesPage, pendingInvites, settlements] =
    await Promise.all([
      api.get<Group>(`/api/groups/${params.groupId}`),
      api.get<{ items: Expense[]; total: number }>(
        `/api/groups/${params.groupId}/expenses?limit=${PAGE_SIZE}&offset=0`,
      ),
      api.get<{ userId: string; name: string; netCents: number }[]>(
        `/api/groups/${params.groupId}/balances`,
      ),
      api.get<{ items: ActivityEntry[]; total: number }>(
        `/api/groups/${params.groupId}/activities?limit=${PAGE_SIZE}&offset=0`,
      ),
      api.get<PendingInvite[]>(`/api/groups/${params.groupId}/join-requests`),
      api.get<Settlement[]>(`/api/groups/${params.groupId}/settlements`),
    ]);

  return {
    group,
    expenses: expensesPage.items,
    expensesTotal: expensesPage.total,
    balances,
    activities: activitiesPage.items,
    activitiesTotal: activitiesPage.total,
    settlements,
    pendingInvites,
  };
}

export default function GroupDetailRoute({ loaderData }: Route.ComponentProps) {
  const {
    group,
    expenses,
    expensesTotal,
    balances,
    activities,
    activitiesTotal,
    settlements,
    pendingInvites,
  } = loaderData;
  const revalidator = useRevalidator();

  return (
    <GroupDetail
      group={group}
      expenses={expenses}
      expensesTotal={expensesTotal}
      balances={balances}
      activities={activities}
      activitiesTotal={activitiesTotal}
      settlements={settlements}
      pendingInvites={pendingInvites}
      onRevalidate={() => revalidator.revalidate()}
    />
  );
}
