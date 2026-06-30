import { FormEvent, useEffect, useState, useCallback } from 'react';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext';
import { useLanguage, type LangPref } from '../context/LanguageContext';
import { CURRENCIES } from '../lib/utils';

type ThemePref = 'auto' | 'light' | 'dark';

function getThemePref(): ThemePref {
  const saved = localStorage.getItem('evenup:theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return 'auto';
}

function applyTheme(pref: ThemePref) {
  const dark =
    pref === 'dark' ||
    (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  localStorage.setItem('evenup:theme', pref);
}
import { api } from '../lib/apiClient';
import { supabase } from '../lib/supabaseClient';
import { SiteHeader } from '../components/layout/SiteHeader';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';

type Status = 'idle' | 'ok' | 'err';

function StatusMsg({
  status,
  okText,
  errText,
}: {
  status: Status;
  okText: string;
  errText: string;
}) {
  if (status === 'idle') return null;
  return (
    <Alert variant={status === 'ok' ? 'default' : 'destructive'} className="mt-3">
      <AlertDescription>{status === 'ok' ? okText : errText}</AlertDescription>
    </Alert>
  );
}

export default function SettingsRoute() {
  const { user, logout, refreshUser } = useAuth();
  const { t, lang, langPref, setLangPref } = useLanguage();
  const navigate = useNavigate();

  useEffect(() => {
    if (!user) navigate('/login');
  }, [user, navigate]);

  // --- Profile ---
  const [name, setName] = useState(user?.name ?? '');
  const [nameSaving, setNameSaving] = useState(false);
  const [nameStatus, setNameStatus] = useState<Status>('idle');
  const [nameError, setNameError] = useState('');

  async function handleSaveName(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setNameSaving(true);
    setNameStatus('idle');
    try {
      await api.patch('/api/auth/me', { name: name.trim() });
      setNameStatus('ok');
    } catch (err) {
      setNameStatus('err');
      setNameError(err instanceof Error ? err.message : t('settings.profile.genericError'));
    } finally {
      setNameSaving(false);
    }
  }

  // --- Password ---
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordStatus, setPasswordStatus] = useState<Status>('idle');
  const [passwordError, setPasswordError] = useState('');

  async function handleSavePassword(e: FormEvent) {
    e.preventDefault();
    if (password !== passwordConfirm) {
      setPasswordStatus('err');
      setPasswordError(t('settings.security.password.mismatch'));
      return;
    }
    setPasswordSaving(true);
    setPasswordStatus('idle');
    try {
      await api.post('/api/auth/change-password', { password });
      setPasswordStatus('ok');
      setPassword('');
      setPasswordConfirm('');
    } catch (err) {
      setPasswordStatus('err');
      setPasswordError(
        err instanceof Error ? err.message : t('settings.security.password.genericError'),
      );
    } finally {
      setPasswordSaving(false);
    }
  }

  // --- Passkey ---
  const [passkeyLoading, setPasskeyLoading] = useState(false);
  const [passkeyStatus, setPasskeyStatus] = useState<Status>('idle');
  const [passkeyError, setPasskeyError] = useState('');

  async function handleAddPasskey() {
    setPasskeyLoading(true);
    setPasskeyStatus('idle');
    try {
      const { access_token, refresh_token } = await api.get<{
        access_token: string;
        refresh_token: string;
      }>('/api/auth/session-tokens');

      await supabase.auth.setSession({ access_token, refresh_token });
      const { error } = await supabase.auth.registerPasskey();
      await supabase.auth.signOut({ scope: 'local' });

      if (error) throw error;
      setPasskeyStatus('ok');
    } catch (err) {
      setPasskeyStatus('err');
      setPasskeyError(err instanceof Error ? err.message : t('settings.security.passkey.error'));
    } finally {
      setPasskeyLoading(false);
    }
  }

  // --- Appearance ---
  const [themePref, setThemePref] = useState<ThemePref>(getThemePref);

  const handleThemeChange = useCallback((pref: ThemePref) => {
    setThemePref(pref);
    applyTheme(pref);
  }, []);

  // --- Currency ---
  const [currencyPref, setCurrencyPref] = useState('EUR');
  const [currencyStatus, setCurrencyStatus] = useState<Status>('idle');

  async function handleCurrencyChange(currency: string) {
    setCurrencyPref(currency);
    setCurrencyStatus('idle');
    try {
      await api.patch('/api/auth/me', { preferredCurrency: currency });
      await refreshUser();
      setCurrencyStatus('ok');
    } catch {
      setCurrencyStatus('err');
    }
  }

  // --- Markup rate ---
  const [markupRate, setMarkupRate] = useState(user?.defaultMarkupRate ?? 0);
  const [markupStatus, setMarkupStatus] = useState<Status>('idle');

  async function handleMarkupRateChange(rate: number) {
    setMarkupRate(rate);
    setMarkupStatus('idle');
    try {
      await api.patch('/api/auth/me', { defaultMarkupRate: rate });
      await refreshUser();
      setMarkupStatus('ok');
    } catch {
      setMarkupStatus('err');
    }
  }

  // --- Delete account ---
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  async function handleDeleteAccount() {
    setDeleting(true);
    setDeleteError('');
    try {
      await api.delete('/api/auth/me');
      await logout();
      navigate('/login');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('settings.account.deleteError'));
      setDeleting(false);
    }
  }

  if (!user) return null;

  return (
    <>
      <SiteHeader />
      <main className="main-content max-w-[560px]">
        <header className="mb-8">
          <Link
            to="/"
            className="text-sm text-muted-foreground hover:text-foreground mb-2 inline-block"
          >
            {t('settings.back')}
          </Link>
          <h1 className="text-h1">{t('settings.title')}</h1>
        </header>

        {/* Profile */}
        <section className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground">{t('settings.profile.title')}</h2>
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSaveName} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="settings-name">{t('settings.profile.nameLabel')}</Label>
                  <Input
                    id="settings-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.profile.emailLabel')}</Label>
                  <p className="text-sm text-muted-foreground py-2 px-3 bg-muted rounded-md">
                    {user.email}
                  </p>
                </div>
                <div className="form-actions">
                  <Button type="submit" disabled={nameSaving || !name.trim()}>
                    {nameSaving ? t('settings.profile.saving') : t('settings.profile.save')}
                  </Button>
                </div>
                <StatusMsg
                  status={nameStatus}
                  okText={t('settings.profile.saveOk')}
                  errText={nameError || t('settings.profile.saveError')}
                />
              </form>
            </CardContent>
          </Card>
        </section>

        {/* Security */}
        <section className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground">{t('settings.security.title')}</h2>

          {/* Passkey */}
          <Card>
            <CardContent className="pt-6 space-y-3">
              <div>
                <p className="font-medium text-sm">{t('settings.security.passkey.title')}</p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.security.passkey.description')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={handleAddPasskey}
                disabled={passkeyLoading}
              >
                {passkeyLoading
                  ? t('settings.security.passkey.setting')
                  : t('settings.security.passkey.setup')}
              </Button>
              <StatusMsg
                status={passkeyStatus}
                okText={t('settings.security.passkey.ok')}
                errText={passkeyError || t('settings.security.passkey.error')}
              />
            </CardContent>
          </Card>

          {/* Password */}
          <Card>
            <CardContent className="pt-6">
              <form onSubmit={handleSavePassword} className="space-y-4">
                <p className="font-medium text-sm">{t('settings.security.password.title')}</p>
                <div className="space-y-2">
                  <Label htmlFor="new-password">{t('settings.security.password.newLabel')}</Label>
                  <Input
                    id="new-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm-password">
                    {t('settings.security.password.confirmLabel')}
                  </Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    value={passwordConfirm}
                    onChange={(e) => setPasswordConfirm(e.target.value)}
                    required
                    minLength={6}
                    autoComplete="new-password"
                  />
                </div>
                <div className="form-actions">
                  <Button type="submit" disabled={passwordSaving}>
                    {passwordSaving
                      ? t('settings.security.password.saving')
                      : t('settings.security.password.save')}
                  </Button>
                </div>
                <StatusMsg
                  status={passwordStatus}
                  okText={t('settings.security.password.ok')}
                  errText={passwordError || t('settings.security.password.error')}
                />
              </form>
            </CardContent>
          </Card>
        </section>

        {/* Appearance */}
        <section className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground">
            {t('settings.appearance.title')}
          </h2>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-2">
                {(['auto', 'light', 'dark'] as ThemePref[]).map((pref) => (
                  <label key={pref} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="theme"
                      value={pref}
                      checked={themePref === pref}
                      onChange={() => handleThemeChange(pref)}
                      className="accent-primary"
                    />
                    <span className="text-sm">
                      {pref === 'auto'
                        ? t('settings.appearance.auto')
                        : pref === 'light'
                          ? t('settings.appearance.light')
                          : t('settings.appearance.dark')}
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Currency */}
        <section className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground">{t('settings.currency.title')}</h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <p className="text-sm text-muted-foreground">{t('settings.currency.label')}</p>
              <select
                className="form-control"
                value={currencyPref}
                onChange={(e) => handleCurrencyChange(e.target.value)}
              >
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <StatusMsg
                status={currencyStatus}
                okText={t('settings.currency.saveOk')}
                errText={t('settings.currency.saveError')}
              />
            </CardContent>
          </Card>
        </section>

        {/* Markup Rate */}
        <section className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground">{t('settings.markup.title')}</h2>
          <Card>
            <CardContent className="pt-6 space-y-3">
              <Label htmlFor="markup-rate">{t('settings.markup.label')}</Label>
              <p className="text-sm text-muted-foreground">{t('settings.markup.description')}</p>
              <Input
                id="markup-rate"
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={markupRate}
                onChange={(e) => setMarkupRate(parseFloat(e.target.value) || 0)}
                onBlur={() => handleMarkupRateChange(markupRate)}
                className="w-32"
              />
              <StatusMsg
                status={markupStatus}
                okText={t('settings.markup.saveOk')}
                errText={t('settings.markup.saveError')}
              />
            </CardContent>
          </Card>
        </section>

        {/* Language */}
        <section className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground">{t('settings.language.title')}</h2>
          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-col gap-2">
                {(['auto', 'de', 'en'] as LangPref[]).map((pref) => (
                  <label key={pref} className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="radio"
                      name="language"
                      value={pref}
                      checked={langPref === pref}
                      onChange={() => {
                        setLangPref(pref);
                        const effectiveLang = pref === 'auto' ? lang : pref;
                        api.patch('/api/auth/me', { lang: effectiveLang }).catch(() => {});
                      }}
                      className="accent-primary"
                    />
                    <span className="text-sm">
                      {pref === 'auto'
                        ? t('settings.language.auto')
                        : pref === 'de'
                          ? t('settings.language.de')
                          : t('settings.language.en')}
                    </span>
                  </label>
                ))}
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Account */}
        <section className="space-y-4 mb-8">
          <h2 className="text-lg font-semibold text-foreground">{t('settings.account.title')}</h2>
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <p className="font-medium text-sm text-destructive">
                  {t('settings.account.deleteTitle')}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  {t('settings.account.deleteDescription')}
                </p>
              </div>
              {!deleteConfirm ? (
                <Button
                  type="button"
                  variant="outline"
                  className="border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground"
                  onClick={() => setDeleteConfirm(true)}
                >
                  {t('settings.account.deleteButton')}
                </Button>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm font-medium text-destructive">
                    {t('settings.account.deleteConfirm')}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setDeleteConfirm(false)}
                      disabled={deleting}
                    >
                      {t('settings.account.cancelButton')}
                    </Button>
                    <Button
                      type="button"
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={handleDeleteAccount}
                      disabled={deleting}
                    >
                      {deleting
                        ? t('settings.account.deletingButton')
                        : t('settings.account.confirmButton')}
                    </Button>
                  </div>
                  {deleteError && (
                    <Alert variant="destructive">
                      <AlertDescription>{deleteError}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </section>
      </main>
    </>
  );
}
