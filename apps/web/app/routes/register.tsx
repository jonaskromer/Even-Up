import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { OAuthButtons } from '../components/auth/OAuthButtons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';

export default function RegisterRoute() {
  const { register } = useAuth();
  const { t, lang } = useLanguage();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmationPending, setConfirmationPending] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const { needsEmailConfirmation } = await register(name, email, password, lang);
      if (needsEmailConfirmation) {
        setConfirmationPending(true);
        return;
      }
      const pending = sessionStorage.getItem('evenup:redirectAfterLogin');
      if (pending) sessionStorage.removeItem('evenup:redirectAfterLogin');
      navigate(pending ?? '/');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('auth.register.error'));
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
          <h1 className="text-h1">{t('auth.register.title')}</h1>
          <p className="text-muted-foreground">{t('auth.register.subtitle')}</p>
        </header>

        {error && (
          <Alert variant="destructive" className="mb-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        {confirmationPending ? (
          <Card>
            <CardContent className="pt-6 space-y-4">
              <p className="text-sm text-muted-foreground">
                {t('auth.register.confirmationPending')}
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSubmit}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="reg-name">{t('auth.register.nameLabel')}</Label>
                    <Input
                      type="text"
                      id="reg-name"
                      name="name"
                      required
                      autoComplete="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-email">{t('auth.register.emailLabel')}</Label>
                    <Input
                      type="email"
                      id="reg-email"
                      name="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reg-password">{t('auth.register.passwordLabel')}</Label>
                    <Input
                      type="password"
                      id="reg-password"
                      name="password"
                      required
                      minLength={6}
                      autoComplete="new-password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                    />
                  </div>
                </div>
                <div className="form-actions">
                  <Button type="submit" className="flex-1" disabled={submitting}>
                    {submitting ? t('auth.register.submitting') : t('auth.register.submit')}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        )}

        <div className="mt-4">
          <OAuthButtons />
        </div>

        <p className="text-muted-foreground text-center mt-4">
          {t('auth.register.hasAccount')} <Link to="/login">{t('auth.register.loginLink')}</Link>
        </p>
      </main>
    </>
  );
}
