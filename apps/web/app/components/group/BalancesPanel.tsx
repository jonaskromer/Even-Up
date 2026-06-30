import { Balance } from '../../types';
import { formatEuro } from '../../lib/computeBalances';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Card, CardContent } from '../ui/card';

interface BalancesPanelProps {
  balances: Balance[];
}

export function BalancesPanel({ balances }: BalancesPanelProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const currentUserId = user?.id ?? '';

  const userBalance = balances.find((b) => b.userId === currentUserId);
  const userCents = userBalance?.netCents ?? 0;
  const userClass = userCents >= 0 ? 'text-success' : 'text-danger';
  const userPrefix = userCents >= 0 ? '+ ' : '- ';

  const others = balances.filter((b) => b.userId !== currentUserId);

  return (
    <Card>
      <CardContent className="pt-6">
        <header className="section-header">
          <h2>{t('balances.title')}</h2>
        </header>

        <div className="mb-6">
          <div className={`${userClass} text-xl font-extrabold font-mono`}>
            {userPrefix}
            {formatEuro(Math.abs(userCents))}
          </div>
          <p className="text-muted-foreground text-sm mb-0">{t('balances.inGroup')}</p>
        </div>

        <h3 className="text-sm uppercase text-accent tracking-wider">{t('balances.whoOwes')}</h3>

        <div className="balance-list mt-4">
          {others.map((b) => {
            const positive = b.netCents >= 0;
            return (
              <div key={b.userId} className="balance-item">
                <span>
                  <strong className="balance-person">{b.name}</strong>
                  {b.email && (
                    <span className="block text-xs text-muted-foreground font-normal">
                      {b.email}
                    </span>
                  )}{' '}
                  {positive ? t('balances.gets') : t('balances.owes')}
                </span>
                <strong className={positive ? 'text-success' : 'text-danger'}>
                  {formatEuro(Math.abs(b.netCents))}
                </strong>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
