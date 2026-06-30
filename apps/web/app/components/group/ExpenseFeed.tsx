import { useState } from 'react';
import { Expense, Group, Settlement } from '../../types';
import { ExpenseItem } from './ExpenseItem';
import { SettlementItem } from './SettlementItem';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../lib/apiClient';

const PAGE_SIZE = 20;

interface ExpenseFeedProps {
  group: Group;
  initialExpenses: Expense[];
  total: number;
  showConverted: boolean;
  settlements?: Settlement[];
  onExpenseDeleted: () => void;
  onSettlementChanged?: () => void;
}

type FeedItem = { kind: 'expense'; item: Expense } | { kind: 'settlement'; item: Settlement };

function sortKey(fi: FeedItem): string {
  const date = fi.item.date;
  const ts = fi.kind === 'expense' ? fi.item.updatedAt : fi.item.createdAt;
  return `${date}_${ts}`;
}

export function ExpenseFeed({
  group,
  initialExpenses,
  total,
  showConverted,
  settlements = [],
  onExpenseDeleted,
  onSettlementChanged,
}: ExpenseFeedProps) {
  const { t } = useLanguage();
  const [extra, setExtra] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);

  const allExpenses = [...initialExpenses, ...extra];
  const hasMore = allExpenses.length < total;

  const feedItems: FeedItem[] = [
    ...allExpenses.map((e): FeedItem => ({ kind: 'expense', item: e })),
    ...settlements.map((s): FeedItem => ({ kind: 'settlement', item: s })),
  ].sort((a, b) => sortKey(b).localeCompare(sortKey(a)));

  const loadMore = async () => {
    setLoading(true);
    try {
      const res = await api.get<{ items: Expense[]; total: number }>(
        `/api/groups/${group.id}/expenses?limit=${PAGE_SIZE}&offset=${allExpenses.length}`,
      );
      setExtra((prev) => [...prev, ...res.items]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="feed-section">
      <header className="section-header">
        <h2>{t('expense.feed.title')}</h2>
        {(total > 0 || settlements.length > 0) && (
          <span className="text-sm text-muted-foreground">
            {t('pagination.showing', { shown: allExpenses.length, total })}
            {settlements.length > 0 && ` + ${settlements.length}`}
          </span>
        )}
      </header>
      <Card>
        <CardContent className="expense-feed">
          {feedItems.length === 0 ? (
            <p className="text-muted-foreground p-4">{t('expense.feed.empty')}</p>
          ) : (
            <>
              {feedItems.map((fi) =>
                fi.kind === 'expense' ? (
                  <ExpenseItem
                    key={`e-${fi.item.id}`}
                    expense={fi.item}
                    group={group}
                    showConverted={showConverted}
                    onDeleted={onExpenseDeleted}
                  />
                ) : (
                  <SettlementItem
                    key={`s-${fi.item.id}`}
                    settlement={fi.item}
                    group={group}
                    onChanged={onSettlementChanged ?? onExpenseDeleted}
                  />
                ),
              )}
              {hasMore && (
                <div className="p-4 flex justify-center">
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
