import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { api } from '../lib/apiClient';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  defaultMarkupRate: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (
    name: string,
    email: string,
    password: string,
    lang?: string,
  ) => Promise<{ needsEmailConfirmation: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<{ user: AuthUser }>('/api/auth/me')
      .then((res) => setUser(res.user))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    await api.post('/api/auth/login', { email, password });
    const res = await api.get<{ user: AuthUser }>('/api/auth/me');
    setUser(res.user);
  }, []);

  const register = useCallback(
    async (name: string, email: string, password: string, lang?: string) => {
      const res = await api.post<{ needsEmailConfirmation: boolean }>('/api/auth/register', {
        name,
        email,
        password,
        ...(lang && { lang }),
      });
      if (!res.needsEmailConfirmation) {
        const me = await api.get<{ user: AuthUser }>('/api/auth/me');
        setUser(me.user);
      }
      return res;
    },
    [],
  );

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout', {}).catch(() => void 0);
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await api.get<{ user: AuthUser }>('/api/auth/me').catch(() => null);
    setUser(res?.user ?? null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside <AuthProvider>');
  }
  return ctx;
}
