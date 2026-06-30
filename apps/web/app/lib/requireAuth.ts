import { redirect } from 'react-router';
import { api } from './apiClient';

export async function requireAuth() {
  try {
    await api.get('/api/auth/me');
  } catch {
    throw redirect('/login');
  }
}
