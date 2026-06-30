import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp } from './app.js';
import { prisma } from '../db/prisma.js';
import { createTestToken } from './authTestHelpers.js';

// vi.mock factories are hoisted above imports, so they can't reference an
// imported helper (it would be accessed before initialization) — the decode
// logic is duplicated inline here instead. Keep in sync with decodeTestToken
// in authTestHelpers.ts.
vi.mock('../services/authService.js', () => ({
  verifyToken: async (token: string) =>
    JSON.parse(Buffer.from(token, 'base64url').toString('utf-8')),
}));

const app = createApp();

beforeAll(async () => {
  await app.ready();
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-auth-' } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-auth-' } } });
  await prisma.$disconnect();
  await app.close();
});

describe('GET /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
    });

    expect(res.statusCode).toBe(401);
  });

  it('returns user with valid Bearer token (backward-compat path)', async () => {
    const user = await prisma.user.create({
      data: {
        id: '11111111-1111-1111-1111-111111111111',
        email: 'test-auth-existing@evenup.local',
        name: 'Existing',
      },
    });
    const token = createTestToken({ sub: user.id, email: user.email, name: user.name });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('test-auth-existing@evenup.local');
  });

  it('returns user with valid sb_access cookie (BFF path)', async () => {
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-auth-existing@evenup.local' },
    });
    const token = createTestToken({ sub: user.id, email: user.email, name: user.name });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: { sb_access: token },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('test-auth-existing@evenup.local');
  });
});

describe('DELETE /api/auth/me', () => {
  it('returns 401 without token', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('deletes the authenticated user and returns 204', async () => {
    const user = await prisma.user.upsert({
      where: { id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' },
      create: {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        email: 'test-auth-delete@evenup.local',
        name: 'ToDelete',
      },
      update: { email: 'test-auth-delete@evenup.local', name: 'ToDelete' },
    });
    const token = createTestToken({ sub: user.id, email: user.email, name: user.name });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(204);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
  });
});

describe('requireAuth lazy user provisioning', () => {
  it('creates the local User row on first request for a brand-new Supabase user', async () => {
    const sub = '22222222-2222-2222-2222-222222222222';
    const token = createTestToken({
      sub,
      email: 'test-auth-new@evenup.local',
      name: 'Brand New',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user).toMatchObject({
      id: sub,
      email: 'test-auth-new@evenup.local',
      name: 'Brand New',
    });

    const created = await prisma.user.findUnique({ where: { id: sub } });
    expect(created).not.toBeNull();
    expect(created?.email).toBe('test-auth-new@evenup.local');
  });

  it('does not duplicate or error on a second request for the same user', async () => {
    const sub = '22222222-2222-2222-2222-222222222222';
    const token = createTestToken({
      sub,
      email: 'test-auth-new@evenup.local',
      name: 'Brand New',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().user.id).toBe(sub);

    const count = await prisma.user.count({ where: { id: sub } });
    expect(count).toBe(1);
  });
});
