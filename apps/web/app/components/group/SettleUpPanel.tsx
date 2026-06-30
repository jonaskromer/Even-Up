import { useEffect, useState } from 'react';
import { Member, Transfer } from '../../types';
import { formatEuro } from '../../lib/computeBalances';
import { useLanguage } from '../../context/LanguageContext';
import { api } from '../../lib/apiClient';
import { Card, CardContent } from '../ui/card';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';

interface SettleUpPanelProps {
  groupId: string;
  members: Member[];
  onSettled: () => void;
}

export function SettleUpPanel({ groupId, members, onSettled }: SettleUpPanelProps) {
  const { t } = useLanguage();
  const [transfers, setTransfers] = useState<Transfer[] | null>(null);
  const [simplify, setSimplify] = useState(true);
  const [loading, setLoading] = useState(false);
  const [settling, setSettling] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [refetchCount, setRefetchCount] = useState(0);

  const memberName = (id: string) => members.find((m) => m.id === id)?.name ?? t('common.unknown');

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError('');
    api
      .get<Transfer[]>(`/api/groups/${groupId}/settle-up?simplify=${simplify}`)
      .then((data) => {
        if (!cancelled) setTransfers(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : t('settleUp.loadError'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, simplify, refetchCount, t]);

  async function recordSettlement(tr: Transfer) {
    const key = `${tr.fromUserId}-${tr.toUserId}`;
    setSettling(key);
    setError('');
    setSuccess('');
    try {
      await api.post(`/api/groups/${groupId}/settlements`, {
        fromUserId: tr.fromUserId,
        toUserId: tr.toUserId,
        amountCents: tr.amountCents,
        date: new Date().toISOString().slice(0, 10),
      });
      setSuccess(
        t('settleUp.recordSuccess', {
          from: memberName(tr.fromUserId),
          to: memberName(tr.toUserId),
          amount: formatEuro(tr.amountCents),
        }),
      );
      onSettled();
      setRefetchCount((c) => c + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settleUp.recordError'));
    } finally {
      setSettling(null);
    }
  }

  return (
    <Card>
      <CardContent className="pt-6">
        <header className="section-header">
          <h2>{t('settleUp.title')}</h2>
        </header>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
        {success && (
          <Alert className="mb-4">
            <AlertDescription>{success}</AlertDescription>
          </Alert>
        )}

        <label className="flex items-center gap-2 text-sm mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={simplify}
            onChange={(e) => setSimplify(e.target.checked)}
            className="rounded border-sand-300"
          />
          {t('settleUp.simplify')}
        </label>

        {loading ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            {t('settleUp.calculating')}
          </p>
        ) : transfers === null || transfers.length === 0 ? (
          <p className="text-muted-foreground text-sm text-center py-4">
            {t('settleUp.allSettled')}
          </p>
        ) : (
          <div className="space-y-3">
            {transfers.map((tr) => {
              const key = `${tr.fromUserId}-${tr.toUserId}`;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between gap-2 py-2 border-b border-dashed border-sand-200 last:border-b-0"
                >
                  <div className="text-sm">
                    <strong>{memberName(tr.fromUserId)}</strong>
                    <span className="text-muted-foreground mx-1">→</span>
                    <strong>{memberName(tr.toUserId)}</strong>
                    <span className="text-danger ml-2 font-mono">{formatEuro(tr.amountCents)}</span>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => recordSettlement(tr)}
                    disabled={settling === key}
                  >
                    {settling === key ? '…' : t('settleUp.record')}
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
