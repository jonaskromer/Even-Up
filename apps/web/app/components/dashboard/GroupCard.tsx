import { Link } from 'react-router';
import { formatEuro } from '../../lib/computeBalances';
import { Group } from '../../types';
import { useLanguage } from '../../context/LanguageContext';

interface GroupCardProps {
  group: Group;
  userNetCents: number;
}

export function GroupCard({ group, userNetCents }: GroupCardProps) {
  const { t } = useLanguage();
  const positive = userNetCents >= 0;
  const balanceClass = positive ? 'text-success' : 'text-danger';
  const balanceLabel = positive ? t('dashboard.youGet') : t('dashboard.youOwe');
  const prefix = positive ? '' : '- ';
  const displayCents = positive ? userNetCents : -userNetCents;

  return (
    <Link to={`/groups/${group.id}`} className="group-item">
      <div className="group-info">
        <h3 className="group-name">{group.name}</h3>
        <span className="group-meta">
          {t('dashboard.memberCount', { n: group.members.length })} • {t('dashboard.lastActivity')}
        </span>
      </div>
      <div className={`group-balance ${balanceClass}`}>
        <span className="balance-label">{balanceLabel}</span>
        <strong>
          {prefix}
          {formatEuro(displayCents)}
        </strong>
      </div>
    </Link>
  );
}
