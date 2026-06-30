import type { Route } from './+types/_index';
import { requireAuth } from '../lib/requireAuth';
import { api } from '../lib/apiClient';
import { SiteHeader } from '../components/layout/SiteHeader';
import { Dashboard } from '../components/dashboard/Dashboard';
import type { Group } from '../types';

type GlobalActivityEntry = {
  id: string;
  groupId: string;
  groupName: string;
  type: string;
  actorName: string;
  data: Record<string, unknown>;
  createdAt: string;
};

export async function clientLoader() {
  await requireAuth();

  const groups = await api.get<Group[]>('/api/groups');

  const [balancesByGroup, activitiesPage] = await Promise.all([
    Promise.all(
      groups.map((g) =>
        api.get<{ userId: string; netCents: number }[]>(`/api/groups/${g.id}/balances`),
      ),
    ),
    api.get<{ items: GlobalActivityEntry[]; total: number }>('/api/activities?limit=20&offset=0'),
  ]);

  const balancesMap = Object.fromEntries(groups.map((g, i) => [g.id, balancesByGroup[i]]));

  return {
    groups,
    balancesMap,
    activities: activitiesPage.items,
    activitiesTotal: activitiesPage.total,
  };
}

export default function IndexRoute({ loaderData }: Route.ComponentProps) {
  const { groups, balancesMap, activities, activitiesTotal } = loaderData;

  return (
    <>
      <SiteHeader />
      <Dashboard
        groups={groups}
        balancesMap={balancesMap}
        activities={activities}
        activitiesTotal={activitiesTotal}
      />
    </>
  );
}
