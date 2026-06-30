import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { requireAuth } from '../lib/requireAuth';
import { useLanguage } from '../context/LanguageContext';
import { api, ApiError } from '../lib/apiClient';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent } from '../components/ui/card';
import { Alert, AlertDescription } from '../components/ui/alert';
import type { Group } from '../types';

export async function clientLoader() {
  await requireAuth();
  return null;
}

export default function NewGroupRoute() {
  const { t } = useLanguage();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setSubmitting(true);
    setError(null);
    try {
      const group = await api.post<Group>('/api/groups', { name: name.trim() });
      navigate(`/groups/${group.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('newGroup.error'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <header className="site-header">
        <div className="header-content">
          <Link to="/" className="brand">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="19" y1="12" x2="5" y2="12"></line>
              <polyline points="12 19 5 12 12 5"></polyline>
            </svg>
            {t('common.overview')}
          </Link>
        </div>
      </header>

      <main className="main-content max-w-[500px]">
        <header className="mb-8">
          <h1 className="text-h1">{t('newGroup.title')}</h1>
          <p className="text-muted-foreground">{t('newGroup.subtitle')}</p>
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
                  <Label htmlFor="group-name">{t('newGroup.nameLabel')}</Label>
                  <Input
                    type="text"
                    id="group-name"
                    name="name"
                    placeholder={t('newGroup.namePlaceholder')}
                    required
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
              </div>
              <div className="form-actions">
                <Button type="submit" className="flex-1" disabled={submitting}>
                  {submitting ? t('newGroup.creating') : t('newGroup.create')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate('/')}
                  disabled={submitting}
                >
                  {t('newGroup.cancel')}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </>
  );
}
