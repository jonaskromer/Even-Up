import { useState } from 'react';
import { Expense, Group } from '../../types';
import { ExpenseItem } from './ExpenseItem';
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
  onExpenseDeleted: () => void;
}

export function ExpenseFeed({
  group,
  initialExpenses,
  total,
  showConverted,
  onExpenseDeleted,
}: ExpenseFeedProps) {
  const { t } = useLanguage();
  const [extra, setExtra] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(false);

  const allExpenses = [...initialExpenses, ...extra].sort((a, b) => b.date.localeCompare(a.date));
  const hasMore = allExpenses.length < total;

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
        {total > 0 && (
          <span className="text-sm text-muted-foreground">
            {t('pagination.showing', { shown: allExpenses.length, total })}
          </span>
        )}
      </header>
      <Card>
        <CardContent className="expense-feed">
          {allExpenses.length === 0 ? (
            <p className="text-muted-foreground p-4">{t('expense.feed.empty')}</p>
          ) : (
            <>
              {allExpenses.map((e) => (
                <ExpenseItem
                  key={e.id}
                  expense={e}
                  group={group}
                  showConverted={showConverted}
                  onDeleted={onExpenseDeleted}
                />
              ))}
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
