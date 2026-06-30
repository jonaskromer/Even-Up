import { useState, useEffect } from 'react';
import { Link, redirect } from 'react-router';
import type { Route } from './+types/invite.$token';
import { api, ApiError } from '../lib/apiClient';
import { useLanguage } from '../context/LanguageContext';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Alert, AlertDescription } from '../components/ui/alert';

interface AcceptResult {
  groupId: string;
  groupName: string;
  alreadyMember: boolean;
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  try {
    await api.get('/api/auth/me');
  } catch {
    sessionStorage.setItem('evenup:redirectAfterLogin', `/invite/${params.token}`);
    throw redirect('/login');
  }
  return { token: params.token };
}

export default function InviteRoute({ loaderData }: Route.ComponentProps) {
  const { token } = loaderData;
  const { t } = useLanguage();
  const [result, setResult] = useState<AcceptResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .post<AcceptResult>(`/api/invites/${token}/accept`, {})
      .then((data) => setResult(data))
      .catch((err) => {
        setError(err instanceof ApiError ? err.message : t('invite.invalidLink'));
      })
      .finally(() => setLoading(false));
  }, [token, t]);

  return (
    <>
      <header className="site-header">
        <div className="header-content">
          <Link to="/" className="brand">
            EvenUp
          </Link>
        </div>
      </header>

      <main className="main-content max-w-[480px]">
        <Card>
          <CardContent className="pt-6 text-center">
            {loading && <p className="text-muted-foreground py-8">{t('invite.loading')}</p>}

            {error && (
              <div className="py-4 space-y-4">
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
                <Link to="/">
                  <Button variant="outline">{t('invite.toOverview')}</Button>
                </Link>
              </div>
            )}

            {result && (
              <div className="py-4 space-y-4">
                <h2 className="text-h2">
                  {result.alreadyMember ? t('invite.alreadyMember') : t('invite.joined')}
                </h2>
                <p className="text-muted-foreground">
                  {result.alreadyMember
                    ? t('invite.alreadyMemberDesc', { group: result.groupName })
                    : t('invite.joinedDesc', { group: result.groupName })}
                </p>
                <Link to={`/groups/${result.groupId}`}>
                  <Button>{t('invite.toGroup')}</Button>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </>
  );
}
