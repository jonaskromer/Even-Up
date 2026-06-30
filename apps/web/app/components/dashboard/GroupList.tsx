import { Link } from 'react-router';
import { Group } from '../../types';
import { GroupCard } from './GroupCard';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/button';

interface GroupListProps {
  groups: Group[];
  balancesMap: Record<string, { userId: string; netCents: number }[]>;
}

export function GroupList({ groups, balancesMap }: GroupListProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const currentUserId = user?.id ?? '';

  return (
    <section className="groups-section">
      <header className="section-header">
        <h2>{t('dashboard.groups')}</h2>
        <Link to="/groups/new">
          <Button variant="outline" size="sm">
            {t('dashboard.newGroup')}
          </Button>
        </Link>
      </header>

      {groups.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-4">{t('dashboard.emptyMessage')}</p>
          <Link to="/groups/new">
            <Button>{t('dashboard.createFirst')}</Button>
          </Link>
        </div>
      ) : (
        <article className="group-list">
          {groups.map((group) => {
            const userNetCents =
              balancesMap[group.id]?.find((b) => b.userId === currentUserId)?.netCents ?? 0;
            return <GroupCard key={group.id} group={group} userNetCents={userNetCents} />;
          })}
        </article>
      )}
    </section>
  );
}
