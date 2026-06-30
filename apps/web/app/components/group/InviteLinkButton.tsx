import { useState } from 'react';
import { api } from '../../lib/apiClient';
import { useLanguage } from '../../context/LanguageContext';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';

interface InviteLinkButtonProps {
  groupId: string;
}

export function InviteLinkButton({ groupId }: InviteLinkButtonProps) {
  const { t, lang } = useLanguage();
  const [inviteUrl, setInviteUrl] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function generateLink() {
    setLoading(true);
    setError('');
    setCopied(false);
    try {
      const data = await api.post<{ token: string; expiresAt: string }>(
        `/api/groups/${groupId}/invites`,
        {},
      );
      setInviteUrl(`${window.location.origin}/invite/${data.token}`);
      setExpiresAt(
        new Date(data.expiresAt).toLocaleDateString(lang === 'de' ? 'de-DE' : 'en-US', {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : t('members.linkError'));
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="mt-4 pt-4 border-t border-sand-200">
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!inviteUrl ? (
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          onClick={generateLink}
          disabled={loading}
        >
          {loading ? t('members.linkCreating') : t('members.linkCreate')}
        </Button>
      ) : (
        <div className="space-y-2">
          <div className="flex gap-2">
            <Input value={inviteUrl} readOnly className="text-xs" />
            <Button size="sm" onClick={copyLink} className="shrink-0">
              {copied ? t('members.copied') : t('members.copy')}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {t('members.linkValidUntil', { date: expiresAt })}
          </p>
        </div>
      )}
    </div>
  );
}
