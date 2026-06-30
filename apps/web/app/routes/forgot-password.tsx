import { FormEvent, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/apiClient';
import { useLanguage } from '../context/LanguageContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';

export default function ForgotPasswordRoute() {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/api/auth/forgot-password', { email });
      setSent(true);
    } catch {
      setError(t('auth.forgotPassword.error'));
    } finally {
      setSubmitting(false);
    }
  };

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
            EvenUp
          </span>
        </div>
      </header>

      <main className="main-content max-w-[400px]">
        <header className="mb-8">
          <h1 className="text-h1">{t('auth.forgotPassword.title')}</h1>
          <p className="text-muted-foreground">{t('auth.forgotPassword.subtitle')}</p>
        </header>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {sent ? (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('auth.forgotPassword.sentMessage')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">{t('auth.login.emailLabel')}</Label>
                    <Input
                      type="email"
                      id="forgot-email"
                      name="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting
                      ? t('auth.forgotPassword.submitting')
                      : t('auth.forgotPassword.submit')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <p className="text-muted-foreground text-center mt-4">
          <Link to="/login">{t('auth.forgotPassword.backToLogin')}</Link>
        </p>
      </main>
    </>
  );
}
