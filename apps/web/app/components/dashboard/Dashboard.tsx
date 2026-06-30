import { Group } from '../../types';
import { BalanceBanner } from './BalanceBanner';
import { GroupList } from './GroupList';
import { useAuth } from '../../context/AuthContext';

interface DashboardProps {
  groups: Group[];
  balancesMap: Record<string, { userId: string; netCents: number }[]>;
}

export function Dashboard({ groups, balancesMap }: DashboardProps) {
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
    </main>
  );
}
