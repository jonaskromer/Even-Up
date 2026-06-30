import { redirect } from 'react-router';
import { api } from './apiClient';
import type { AuthUser } from '../context/AuthContext';

export async function requireAuth(): Promise<AuthUser> {
  try {
    const res = await api.get<{ user: AuthUser }>('/api/auth/me');
    return res.user;
  } catch {
    throw redirect('/login');
  }
}
