import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useRevalidator } from 'react-router';
import { api } from '../lib/apiClient';
import type { JoinRequest } from '../types';
import { useAuth } from './AuthContext';

interface PendingInvitesContextValue {
  requests: JoinRequest[];
  accept: (id: string) => Promise<void>;
  decline: (id: string) => Promise<void>;
  refetch: () => void;
}

const PendingInvitesContext = createContext<PendingInvitesContextValue | null>(null);

export function PendingInvitesProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const revalidator = useRevalidator();
  const [rawRequests, setRawRequests] = useState<JoinRequest[]>([]);
  // Derived: empty when logged out without needing a sync setState in an effect.
  const requests = user ? rawRequests : [];

  const refetch = useCallback(() => {
    if (!user) return;
    api
      .get<JoinRequest[]>('/api/join-requests')
      .then(setRawRequests)
      .catch(() => setRawRequests([]));
  }, [user]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const accept = useCallback(
    async (id: string) => {
      await api.post(`/api/join-requests/${id}/accept`, {});
      refetch();
      revalidator.revalidate();
    },
    [refetch, revalidator],
  );

  const decline = useCallback(
    async (id: string) => {
      await api.post(`/api/join-requests/${id}/decline`, {});
      refetch();
    },
    [refetch],
  );

  return (
    <PendingInvitesContext.Provider value={{ requests, accept, decline, refetch }}>
      {children}
    </PendingInvitesContext.Provider>
  );
}

export function usePendingInvites(): PendingInvitesContextValue {
  const ctx = useContext(PendingInvitesContext);
  if (!ctx) {
    throw new Error('usePendingInvites must be used inside <PendingInvitesProvider>');
  }
  return ctx;
}
