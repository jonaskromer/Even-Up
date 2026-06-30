import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp } from './app.js';
import { prisma } from '../db/prisma.js';
import { createTestToken } from './authTestHelpers.js';

vi.mock('../services/authService.js', () => ({
  verifyToken: async (token: string) =>
    JSON.parse(Buffer.from(token, 'base64url').toString('utf-8')),
}));

const app = createApp();

let token: string;
let groupId: string;

beforeAll(async () => {
  await app.ready();

  const owner = await prisma.user.upsert({
    where: { id: '99999999-9999-9999-9999-999999999999' },
    create: {
      id: '99999999-9999-9999-9999-999999999999',
      email: 'test-grp-owner@evenup.local',
      name: 'GroupOwner',
    },
    update: { email: 'test-grp-owner@evenup.local', name: 'GroupOwner' },
  });
  token = createTestToken({ sub: owner.id, email: owner.email, name: owner.name });
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { name: { startsWith: 'Test-Grp-' } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-grp-' } } });
  await prisma.$disconnect();
  await app.close();
});

describe('GET /api/groups', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/groups' });
    expect(res.statusCode).toBe(401);
  });

  it('returns an array for an authenticated user', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/groups',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});

describe('POST /api/groups', () => {
  it('creates a group and returns it with the creator as owner', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/groups',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'Test-Grp-Create' },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe('Test-Grp-Create');
    expect(body.members).toHaveLength(1);
    expect(body.members[0].role).toBe('owner');
    groupId = body.id;
  });
});

describe('GET /api/groups/:id', () => {
  it('returns the group with members', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(groupId);
    expect(res.json().members).toHaveLength(1);
  });

  it('returns 403 for a non-member', async () => {
    const outsider = await prisma.user.upsert({
      where: { id: '99999999-9999-9999-9999-999999999998' },
      create: {
        id: '99999999-9999-9999-9999-999999999998',
        email: 'test-grp-outsider@evenup.local',
        name: 'Outsider',
      },
      update: { email: 'test-grp-outsider@evenup.local', name: 'Outsider' },
    });
    const outsiderToken = createTestToken({
      sub: outsider.id,
      email: outsider.email,
      name: outsider.name,
    });
    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/groups/:id/balances', () => {
  it('returns a balances array', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
  });
});
