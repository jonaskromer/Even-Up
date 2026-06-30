import { useState } from 'react';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { formatEuro } from '../../lib/computeBalances';
import { useLanguage } from '../../context/LanguageContext';
import type { TFunc } from '../../context/LanguageContext';
import { api } from '../../lib/apiClient';

const PAGE_SIZE = 20;

interface ActivityEntry {
  id: string;
  type: string;
  actorName: string;
  data: Record<string, unknown>;
  createdAt: string;
}

interface ActivityLogProps {
  groupId: string;
  initialActivities: ActivityEntry[];
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
    default:
      return t('activity.defaultAction', { actor });
  }
}

function activityIcon(type: string) {
  switch (type) {
    case 'expense_created':
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      );
    case 'expense_edited':
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
      );
    case 'expense_deleted':
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="3 6 5 6 21 6" />
          <path d="M19 6l-1 14H6L5 6" />
          <path d="M10 11v6" />
          <path d="M14 11v6" />
          <path d="M9 6V4h6v2" />
        </svg>
      );
    case 'member_added':
    case 'member_invited':
    case 'member_joined':
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <line x1="19" y1="8" x2="19" y2="14" />
          <line x1="22" y1="11" x2="16" y2="11" />
        </svg>
      );
    case 'settlement_recorded':
      return (
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    default:
      return null;
  }
}

export function ActivityLog({ groupId, initialActivities, total }: ActivityLogProps) {
  const { t } = useLanguage();
  const [extra, setExtra] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const allActivities = [...initialActivities, ...extra];
  const hasMore = allActivities.length < total;

  const loadMore = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: ActivityEntry[]; total: number }>(
        `/api/groups/${groupId}/activities?limit=${PAGE_SIZE}&offset=${allActivities.length}`,
      );
      setExtra((prev) => [...prev, ...res.items]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <header className="section-header">
          <h2>{t('activity.title')}</h2>
          {total > 0 && (
            <span className="text-sm text-muted-foreground">
              {t('pagination.showing', { shown: allActivities.length, total })}
            </span>
          )}
        </header>

        {allActivities.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('activity.empty')}</p>
        ) : (
          <>
            <ul className="space-y-0">
              {allActivities.map((a) => (
                <li
                  key={a.id}
                  className="flex gap-3 py-2.5 border-b border-dashed last:border-0 border-border text-sm"
                >
                  <span className="mt-0.5 text-muted-foreground shrink-0">
                    {activityIcon(a.type)}
                  </span>
                  <span className="flex-1 leading-snug">
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
  );
}
