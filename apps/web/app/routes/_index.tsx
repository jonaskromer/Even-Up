import type { Route } from './+types/_index';
import { requireAuth } from '../lib/requireAuth';
import { api } from '../lib/apiClient';
import { SiteHeader } from '../components/layout/SiteHeader';
import { Dashboard } from '../components/dashboard/Dashboard';
import type { Group } from '../types';

export async function clientLoader() {
  await requireAuth();

  const groups = await api.get<Group[]>('/api/groups');

  const balancesByGroup = await Promise.all(
    groups.map((g) =>
      api.get<{ userId: string; netCents: number }[]>(`/api/groups/${g.id}/balances`),
    ),
  );

  const balancesMap = Object.fromEntries(groups.map((g, i) => [g.id, balancesByGroup[i]]));

  return { groups, balancesMap };
}

export default function IndexRoute({ loaderData }: Route.ComponentProps) {
  const { groups, balancesMap } = loaderData;

  return (
    <>
      <SiteHeader />
      <Dashboard groups={groups} balancesMap={balancesMap} />
    </>
  );
}
