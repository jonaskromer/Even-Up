import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/apiClient';

// This route is a fallback for client-side OAuth redirects that land on the SPA.
// The primary OAuth flow is server-initiated via GET /api/auth/google →
// GET /api/auth/callback, so this page should rarely be reached.
export default function AuthCallbackRoute() {
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<{ user: unknown }>('/api/auth/me')
      .then(() => navigate('/', { replace: true }))
      .catch(() => navigate('/login', { replace: true }));
  }, [navigate]);

  return (
    <main className="main-content max-w-[400px]">
      <p className="text-muted-foreground text-center mt-8">Anmeldung läuft…</p>
    </main>
  );
}
