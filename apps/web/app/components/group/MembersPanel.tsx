import { Member, PendingInvite } from '../../types';
import { Card, CardContent } from '../ui/card';
import { AddMemberForm } from './AddMemberForm';
import { InviteLinkButton } from './InviteLinkButton';
import { useLanguage } from '../../context/LanguageContext';

interface MembersPanelProps {
  groupId: string;
  members: Member[];
  pendingInvites: PendingInvite[];
  onMemberAdded: () => void;
}

export function MembersPanel({
  groupId,
  members,
  pendingInvites,
  onMemberAdded,
}: MembersPanelProps) {
  const { t } = useLanguage();

  return (
    <Card>
      <CardContent className="pt-6">
        <header className="section-header">
          <h2>{t('members.title')}</h2>
        </header>

        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.id} className="flex justify-between items-center py-1.5 text-sm">
              <span>
                <span className="font-medium">{m.name}</span>
                {m.email && <span className="block text-xs text-muted-foreground">{m.email}</span>}
              </span>
              <span className="text-muted-foreground text-xs">
                {m.role === 'owner' ? t('members.roleOwner') : t('members.roleMember')}
              </span>
            </li>
          ))}
        </ul>

        {pendingInvites.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted-foreground mb-1">
              {t('members.pendingInvites')}
            </p>
            <ul className="space-y-1">
              {pendingInvites.map((p) => (
                <li key={p.id} className="flex justify-between items-center py-1 text-sm">
                  <span>
                    <span className="font-medium">{p.invitedName}</span>
                    <span className="block text-xs text-muted-foreground">{p.invitedEmail}</span>
                  </span>
                  <span className="text-muted-foreground text-xs">{t('members.pending')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <AddMemberForm groupId={groupId} onMemberAdded={onMemberAdded} />
        <InviteLinkButton groupId={groupId} />
      </CardContent>
    </Card>
  );
}
