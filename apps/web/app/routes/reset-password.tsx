import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { supabase } from '../lib/supabaseClient';
import { useLanguage } from '../context/LanguageContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';

export default function ResetPasswordRoute() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [hasRecoverySession, setHasRecoverySession] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setHasRecoverySession(true);
    });

    const code = new URLSearchParams(window.location.search).get('code');
    if (code) {
      supabase.auth.exchangeCodeForSession(code).then(({ error }) => {
        if (error) setHasRecoverySession(false);
      });
    } else {
      supabase.auth.getSession().then(({ data }) => {
        if (!data.session) setHasRecoverySession(false);
      });
    }

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError(t('auth.resetPassword.mismatchError'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      await supabase.auth.signOut();
      navigate('/login?reset=1');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.resetPassword.error'));
    } finally {
      setSubmitting(false);
    }
  };

  if (hasRecoverySession === false) {
    return (
      <main className="main-content max-w-[400px]">
        <Alert variant="destructive">
          <AlertDescription>{t('auth.resetPassword.invalidLink')}</AlertDescription>
        </Alert>
        <p className="text-center mt-4">
          <Link to="/forgot-password">{t('auth.resetPassword.requestNewLink')}</Link>
        </p>
      </main>
    );
  }

  if (hasRecoverySession === null) {
    return null;
  }

  return (
    <>
      <header className="site-header">
        <div className="header-content">
          <span className="brand">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="2" x2="12" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
            Even-Up
          </span>
        </div>
      </header>

      <main className="main-content max-w-[400px]">
        <header className="mb-8">
          <h1 className="text-h1">{t('auth.resetPassword.title')}</h1>
          <p className="text-muted-foreground">{t('auth.resetPassword.subtitle')}</p>
        </header>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <Card>
          <CardContent className="pt-6">
            <form onSubmit={handleSubmit}>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">{t('auth.resetPassword.newPasswordLabel')}</Label>
                  <Input
                    type="password"
                    id="new-password"
                    name="password"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">
                    {t('auth.resetPassword.confirmPasswordLabel')}
                  </Label>
                  <Input
                    type="password"
                    id="confirm-password"
                    name="confirm"
                    required
                    minLength={6}
                    autoComplete="new-password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <Button type="submit" className="flex-1" disabled={submitting}>
                  {submitting ? t('auth.resetPassword.submitting') : t('auth.resetPassword.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
