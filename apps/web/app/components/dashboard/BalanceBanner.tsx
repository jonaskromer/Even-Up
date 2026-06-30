import { formatEuro } from '../../lib/computeBalances';
import { useLanguage } from '../../context/LanguageContext';

interface BalanceBannerProps {
  totalCents: number;
}

export function BalanceBanner({ totalCents }: BalanceBannerProps) {
  const { t } = useLanguage();
  const positive = totalCents >= 0;
  const prefix = positive ? '+ ' : '';
  return (
    <section className="balance-banner">
      <h2>{t('dashboard.totalBalance')}</h2>
      <span className="balance-amount">
        {prefix}
        {formatEuro(totalCents)}
      </span>
      <p className="text-white/80 mb-0">
        {positive ? t('dashboard.positive') : t('dashboard.negative')}
      </p>
    </section>
  );
}
