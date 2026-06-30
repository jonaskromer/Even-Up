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
let userId: string;
let otherUserId: string;

beforeAll(async () => {
  await app.ready();
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-settle-' } } });

  const owner = await prisma.user.create({
    data: {
      id: '44444444-4444-4444-4444-444444444444',
      email: 'test-settle-owner@evenup.local',
      name: 'Owner',
    },
  });
  token = createTestToken({ sub: owner.id, email: owner.email, name: owner.name });
  userId = owner.id;

  const other = await prisma.user.create({
    data: {
      id: '55555555-5555-5555-5555-555555555555',
      email: 'test-settle-other@evenup.local',
      name: 'Other',
    },
  });
  const otherToken = createTestToken({ sub: other.id, email: other.email, name: other.name });
  otherUserId = other.id;

  const groupRes = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Settlement Test Group' },
  });
  groupId = groupRes.json().id;

  await app.inject({
    method: 'POST',
    url: `/api/groups/${groupId}/members`,
    headers: { authorization: `Bearer ${token}` },
    payload: { email: 'test-settle-other@evenup.local' },
  });

  const joinRequest = await prisma.groupJoinRequest.findFirstOrThrow({
    where: { groupId, invitedUserId: otherUserId, status: 'pending' },
  });
  await app.inject({
    method: 'POST',
    url: `/api/join-requests/${joinRequest.id}/accept`,
    headers: { authorization: `Bearer ${otherToken}` },
  });

  await app.inject({
    method: 'POST',
    url: `/api/groups/${groupId}/expenses`,
    headers: { authorization: `Bearer ${token}` },
    payload: {
      description: 'Dinner',
      amountCents: 6000,
      paidByUserId: userId,
      date: '2026-04-01',
    },
  });
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { name: 'Settlement Test Group' } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-settle-' } } });
  await prisma.$disconnect();
  await app.close();
});

describe('POST /api/groups/:id/settlements', () => {
  it('records a settlement', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/settlements`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        fromUserId: otherUserId,
        toUserId: userId,
        amountCents: 3000,
        date: '2026-04-02',
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().amountCents).toBe(3000);
    expect(res.json().fromUserId).toBe(otherUserId);
    expect(res.json().toUserId).toBe(userId);
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/settlements`,
      payload: {
        fromUserId: otherUserId,
        toUserId: userId,
        amountCents: 1000,
        date: '2026-04-02',
      },
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('GET /api/groups/:id/settle-up', () => {
  it('returns suggested transfers', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/settle-up?simplify=true`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const transfers = res.json();
    expect(Array.isArray(transfers)).toBe(true);
  });

  it('settlements reduce outstanding balances', async () => {
    const balancesRes = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/balances`,
      headers: { authorization: `Bearer ${token}` },
    });

    const balances = balancesRes.json();
    const ownerBalance = balances.find((b: { userId: string }) => b.userId === userId);
    const otherBalance = balances.find((b: { userId: string }) => b.userId === otherUserId);

    // 6000 expense paid by owner, split 2 ways = 3000 each
    // Owner net: +6000 - 3000 = +3000, then settlement of 3000 reduces: +3000 - 3000 = 0
    // Other net: -3000, then settlement of 3000 increases: -3000 + 3000 = 0
    expect(ownerBalance.netCents).toBe(0);
    expect(otherBalance.netCents).toBe(0);
  });
});
