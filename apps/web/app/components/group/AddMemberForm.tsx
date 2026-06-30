import { FormEvent, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Alert, AlertDescription } from '../ui/alert';
import { useLanguage } from '../../context/LanguageContext';
import { api, ApiError } from '../../lib/apiClient';

interface AddMemberFormProps {
  groupId: string;
  onMemberAdded: () => void;
}

export function AddMemberForm({ groupId, onMemberAdded }: AddMemberFormProps) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;

    setSubmitting(true);
    setError(null);
    setSuccess(null);
    try {
      await api.post(`/api/groups/${groupId}/members`, { email: email.trim() });
      setSuccess(t('members.inviteSuccess', { email: email.trim() }));
      setEmail('');
      onMemberAdded();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('members.inviteError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      {error && (
        <Alert variant="destructive" className="mb-3">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="mb-3">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      <div className="flex gap-2">
        <Input
          type="email"
          placeholder={t('members.emailPlaceholder')}
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="flex-1"
        />
        <Button type="submit" size="sm" disabled={submitting}>
          {submitting ? t('members.inviting') : t('members.invite')}
        </Button>
      </div>
    </form>
  );
}
