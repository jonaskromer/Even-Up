import { Group } from '../../types';
import { BalanceBanner } from './BalanceBanner';
import { GroupList } from './GroupList';
import { GlobalActivityFeed } from './GlobalActivityFeed';
import { useAuth } from '../../context/AuthContext';

type GlobalActivityEntry = {
  id: string;
  groupId: string;
  groupName: string;
  type: string;
  actorName: string;
  data: Record<string, unknown>;
  createdAt: string;
};

interface DashboardProps {
  groups: Group[];
  balancesMap: Record<string, { userId: string; netCents: number }[]>;
  activities: GlobalActivityEntry[];
  activitiesTotal: number;
}

export function Dashboard({ groups, balancesMap, activities, activitiesTotal }: DashboardProps) {
  const { user } = useAuth();
  const currentUserId = user?.id ?? '';

  const totalCents = groups.reduce((sum, group) => {
    const net = balancesMap[group.id]?.find((b) => b.userId === currentUserId)?.netCents ?? 0;
    return sum + net;
  }, 0);

  return (
    <main className="main-content">
      <BalanceBanner totalCents={totalCents} />
      <GroupList groups={groups} balancesMap={balancesMap} />
      {activitiesTotal > 0 && (
        <GlobalActivityFeed initialActivities={activities} total={activitiesTotal} />
      )}
    </main>
  );
}
