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

let token: string;
let groupId: string;

beforeAll(async () => {
  await app.ready();
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-exp-' } } });

  const owner = await prisma.user.create({
    data: {
      id: '33333333-3333-3333-3333-333333333333',
      email: 'test-exp-owner@evenup.local',
      name: 'Owner',
    },
  });
  token = createTestToken({ sub: owner.id, email: owner.email, name: owner.name });

  const groupRes = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Test Group' },
  });
  groupId = groupRes.json().id;
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { name: 'Test Group' } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-exp-' } } });
  await prisma.$disconnect();
  await app.close();
});

describe('POST /api/groups/:groupId/expenses', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      payload: {
        description: 'Test',
        amountCents: 5000,
        paidByUserId: 'fake',
        date: '2026-01-01',
      },
    });

    expect(res.statusCode).toBe(401);
  });

  it('creates an expense for an authenticated group member', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Testausgabe',
        amountCents: 5000,
        paidByUserId: owner.id,
        date: '2026-01-01',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().description).toBe('Testausgabe');
    expect(res.json().amountCents).toBe(5000);

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().items.length).toBeGreaterThanOrEqual(1);
    expect(typeof listRes.json().total).toBe('number');
  });

  it('stores exactSplits when provided (partial participants)', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Nur ich',
        amountCents: 3000,
        paidByUserId: owner.id,
        date: '2026-01-01',
        exactSplits: [{ userId: owner.id, owedCents: 3000 }],
      },
    });

    expect(res.statusCode).toBe(201);
    const splits = res.json().splits as { userId: string; owedCents: number }[];
    expect(splits).toHaveLength(1);
    expect(splits[0].userId).toBe(owner.id);
    expect(splits[0].owedCents).toBe(3000);
  });
});

describe('PUT /api/groups/:groupId/expenses/:expenseId', () => {
  it('updates splits when exactSplits and correct updatedAt are provided', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Edit-Test',
        amountCents: 6000,
        paidByUserId: owner.id,
        date: '2026-01-01',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { id: expenseId, updatedAt } = createRes.json() as { id: string; updatedAt: string };

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}/expenses/${expenseId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Edit-Test',
        amountCents: 6000,
        paidByUserId: owner.id,
        date: '2026-01-01',
        exactSplits: [{ userId: owner.id, owedCents: 6000 }],
        updatedAt,
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const splits = updateRes.json().splits as { userId: string; owedCents: number }[];
    expect(splits).toHaveLength(1);
    expect(splits[0].owedCents).toBe(6000);
  });

  it('returns 409 when updatedAt is stale (concurrent edit conflict)', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Conflict-Test',
        amountCents: 1000,
        paidByUserId: owner.id,
        date: '2026-01-01',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const expenseId = createRes.json().id as string;

    const res = await app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}/expenses/${expenseId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Conflict-Test',
        amountCents: 1000,
        paidByUserId: owner.id,
        date: '2026-01-01',
        updatedAt: '2000-01-01T00:00:00.000Z', // stale timestamp
      },
    });

    expect(res.statusCode).toBe(409);
  });
});
