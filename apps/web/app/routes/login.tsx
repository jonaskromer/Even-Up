import { FormEvent, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';

export default function LoginRoute() {
  const { login } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
      const pending = sessionStorage.getItem('evenup:redirectAfterLogin');
      if (pending) sessionStorage.removeItem('evenup:redirectAfterLogin');
      navigate(pending ?? '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.login.error'));
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
          <h1 className="text-h1">{t('auth.login.title')}</h1>
          <p className="text-muted-foreground">{t('auth.login.subtitle')}</p>
        </header>

        {searchParams.get('reset') === '1' && (
          <Alert className="mb-4">
            <AlertDescription>{t('auth.login.passwordResetSuccess')}</AlertDescription>
          </Alert>
        )}

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
                  <Label htmlFor="login-email">{t('auth.login.emailLabel')}</Label>
                  <Input
                    type="email"
                    id="login-email"
                    name="email"
                    required
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label htmlFor="login-password">{t('auth.login.passwordLabel')}</Label>
                    <Link
                      to="/forgot-password"
                      className="text-sm text-muted-foreground hover:text-foreground"
                    >
                      {t('auth.login.forgotPassword')}
                    </Link>
                  </div>
                  <Input
                    type="password"
                    id="login-password"
                    name="password"
                    required
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <Button type="submit" className="flex-1" disabled={submitting}>
                  {submitting ? t('auth.login.submitting') : t('auth.login.submit')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <div className="mt-4">
          <OAuthButtons
            showPasskey
            onPasskeySuccess={() => {
              const pending = sessionStorage.getItem('evenup:redirectAfterLogin');
              if (pending) sessionStorage.removeItem('evenup:redirectAfterLogin');
              navigate(pending ?? '/');
            }}
          />
        </div>

        <p className="text-muted-foreground text-center mt-4">
          {t('auth.login.noAccount')} <Link to="/register">{t('auth.login.registerLink')}</Link>
        </p>
      </main>
    </>
  );
}
