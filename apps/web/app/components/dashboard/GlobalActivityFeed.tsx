import { useState } from 'react';
import { Link } from 'react-router';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { formatEuro } from '../../lib/computeBalances';
import { useLanguage } from '../../context/LanguageContext';
import type { TFunc } from '../../context/LanguageContext';
import { api } from '../../lib/apiClient';

const PAGE_SIZE = 20;

interface GlobalActivityEntry {
  id: string;
  groupId: string;
  groupName: string;
  type: string;
  actorName: string;
  data: Record<string, unknown>;
  createdAt: string;
}

interface GlobalActivityFeedProps {
  initialActivities: GlobalActivityEntry[];
  total: number;
}

function relativeTime(iso: string, t: TFunc): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return t('activity.justNow');
  if (min < 60) return t('activity.minutesAgo', { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t('activity.hoursAgo', { n: h });
  const d = Math.floor(h / 24);
  if (d < 7)
    return d === 1 ? t('activity.daysAgo', { n: d }) : t('activity.daysAgoPlural', { n: d });
  const w = Math.floor(d / 7);
  if (w < 5)
    return w === 1 ? t('activity.weeksAgo', { n: w }) : t('activity.weeksAgoPlural', { n: w });
  const mo = Math.floor(d / 30);
  return mo === 1 ? t('activity.monthsAgo', { n: mo }) : t('activity.monthsAgoPlural', { n: mo });
}

function activityText(
  type: string,
  actor: string,
  data: Record<string, unknown>,
  t: TFunc,
): string {
  const desc = data.description as string | undefined;
  const cents = data.amountCents as number | undefined;
  const amount = cents != null ? formatEuro(cents) : '';

  switch (type) {
    case 'expense_created':
      return t('activity.expenseCreated', { actor, desc: desc ?? '', amount });
    case 'expense_edited':
      return t('activity.expenseEdited', { actor, desc: desc ?? '' });
    case 'expense_deleted':
      return t('activity.expenseDeleted', { actor, desc: desc ?? '', amount });
    case 'member_added':
      return t('activity.memberAdded', { actor, member: data.memberName as string });
    case 'member_invited':
      return t('activity.memberInvited', { actor, member: data.memberName as string });
    case 'member_joined':
      return t('activity.memberJoined', { actor });
    case 'settlement_recorded':
      return t('activity.settlementRecorded', {
        from: data.fromName as string,
        amount,
        to: data.toName as string,
      });
    case 'settlement_edited':
      return t('activity.settlementEdited', { actor });
    case 'settlement_deleted':
      return t('activity.settlementDeleted', { actor });
    default:
      return t('activity.defaultAction', { actor });
  }
}

export function GlobalActivityFeed({ initialActivities, total }: GlobalActivityFeedProps) {
  const { t } = useLanguage();
  const [extra, setExtra] = useState<GlobalActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const allActivities = [...initialActivities, ...extra];
  const hasMore = allActivities.length < total;

  const loadMore = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: GlobalActivityEntry[]; total: number }>(
        `/api/activities?limit=${PAGE_SIZE}&offset=${allActivities.length}`,
      );
      setExtra((prev) => [...prev, ...res.items]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="mt-8">
      <header className="section-header mb-3">
        <h2 className="text-lg font-semibold">{t('activity.globalFeed.title')}</h2>
        {total > 0 && (
          <span className="text-sm text-muted-foreground">
            {t('pagination.showing', { shown: allActivities.length, total })}
          </span>
        )}
      </header>
      <Card>
        <CardContent className="pt-4">
          {allActivities.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">{t('activity.empty')}</p>
          ) : (
            <>
              <ul className="space-y-0">
                {allActivities.map((a) => (
                  <li
                    key={a.id}
                    className="flex gap-3 py-2.5 border-b border-dashed last:border-0 border-border text-sm"
                  >
                    <span className="flex-1 leading-snug min-w-0">
                      <Link
                        to={`/groups/${a.groupId}`}
                        className="text-xs font-medium text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded mr-2 hover:bg-primary/20 transition-colors"
                      >
                        {a.groupName}
                      </Link>
                      {activityText(a.type, a.actorName, a.data, t)}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                      {relativeTime(a.createdAt, t)}
                    </span>
                  </li>
                ))}
              </ul>
              {hasMore && (
                <div className="pt-3 flex justify-center">
                  <Button variant="outline" size="sm" onClick={loadMore} disabled={loading}>
                    {loading ? t('pagination.loading') : t('pagination.loadMore')}
                  </Button>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
