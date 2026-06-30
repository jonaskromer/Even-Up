import { Balance } from '../../types';
import { formatCurrency } from '../../lib/utils';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { Card, CardContent } from '../ui/card';

interface PerCurrencyBalance {
  currency: string;
  balances: Balance[];
}

interface BalancesPanelProps {
  balances: Balance[];
  groupCurrency: string;
  showConverted: boolean;
  perCurrencyBalances?: PerCurrencyBalance[];
}

export function BalancesPanel({
  balances,
  groupCurrency,
  showConverted,
  perCurrencyBalances,
}: BalancesPanelProps) {
  const { user } = useAuth();
  const { t } = useLanguage();
  const currentUserId = user?.id ?? '';

  if (showConverted || !perCurrencyBalances || perCurrencyBalances.length === 0) {
    // Standard single-currency view
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
              {formatCurrency(Math.abs(userCents), groupCurrency)}
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
                    {formatCurrency(Math.abs(b.netCents), groupCurrency)}
                  </strong>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    );
  }

  // Per-currency view (toggle OFF)
  return (
    <Card>
      <CardContent className="pt-6">
        <header className="section-header">
          <h2>{t('balances.title')}</h2>
        </header>

        {perCurrencyBalances.map(({ currency, balances: cb }) => {
          const userBal = cb.find((b) => b.userId === currentUserId);
          const userCents = userBal?.netCents ?? 0;
          const userClass = userCents >= 0 ? 'text-success' : 'text-danger';
          const others = cb.filter((b) => b.userId !== currentUserId);

          return (
            <div key={currency} className="mb-6">
              <p className="text-xs uppercase text-accent tracking-wider mb-1">{currency}</p>
              {userBal && (
                <div className={`${userClass} text-lg font-bold font-mono mb-2`}>
                  {userCents >= 0 ? '+ ' : '- '}
                  {formatCurrency(Math.abs(userCents), currency)}
                </div>
              )}
              <div className="balance-list">
                {others.map((b) => {
                  const positive = b.netCents >= 0;
                  return (
                    <div key={b.userId} className="balance-item">
                      <span>
                        <strong className="balance-person">{b.name}</strong>{' '}
                        {positive ? t('balances.gets') : t('balances.owes')}
                      </span>
                      <strong className={positive ? 'text-success' : 'text-danger'}>
                        {formatCurrency(Math.abs(b.netCents), currency)}
                      </strong>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
