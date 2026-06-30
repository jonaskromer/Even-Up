import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '../ui/button';
import { usePendingInvites } from '../../context/PendingInvitesContext';
import { useLanguage } from '../../context/LanguageContext';

export function PendingInvitationsBell() {
  const { requests, accept, decline } = usePendingInvites();
  const { t } = useLanguage();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (requests.length === 0 && !open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={t('nav.invitations')}
        className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <BellIcon />
      </button>
    );
  }

  const handleAccept = async (id: string) => {
    setBusyId(id);
    try {
      await accept(id);
    } finally {
      setBusyId(null);
    }
  };

  const handleDecline = async (id: string) => {
    setBusyId(id);
    try {
      await decline(id);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t('nav.invitations')}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
      >
        <BellIcon />
        {requests.length > 0 && (
          <span className="absolute top-0 right-0 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-semibold leading-none">
            {requests.length}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 rounded-md border bg-card shadow-md z-50 p-2">
          <p className="text-sm font-medium px-2 py-1">{t('invitations.title')}</p>
          {requests.length === 0 ? (
            <p className="text-sm text-muted-foreground px-2 py-2">{t('invitations.empty')}</p>
          ) : (
            <ul className="space-y-2">
              {requests.map((r) => (
                <li key={r.id} className="rounded-md border p-2">
                  <p className="text-sm">
                    <Link to={`/groups/${r.groupId}`} className="font-medium hover:underline">
                      {r.groupName}
                    </Link>
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">
                    {t('invitations.invitedBy', { name: r.invitedByName })}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      disabled={busyId === r.id}
                      onClick={() => handleAccept(r.id)}
                    >
                      {t('invitations.accept')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={busyId === r.id}
                      onClick={() => handleDecline(r.id)}
                    >
                      {t('invitations.decline')}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
    </svg>
  );
}
