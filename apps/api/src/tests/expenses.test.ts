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
    url: '/api/v1/groups',
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
      url: `/api/v1/groups/${groupId}/expenses`,
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
      url: `/api/v1/groups/${groupId}/expenses`,
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
    expect(res.json().originalAmountCents).toBe(5000);
    expect(res.json().originalCurrency).toBe('EUR');

    const listRes = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/expenses`,
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
      url: `/api/v1/groups/${groupId}/expenses`,
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

  it('applies markupRate to amountCents and stores appliedMarkupRate', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Markup test',
        amountCents: 5000,
        paidByUserId: owner.id,
        date: '2026-01-01',
        markupRate: 2.5,
      },
    });

    expect(res.statusCode).toBe(201);
    // 5000 × 1.025 = 5125
    expect(res.json().amountCents).toBe(5125);
    expect(res.json().originalAmountCents).toBe(5000);
    expect(res.json().appliedMarkupRate).toBe(2.5);
  });
});

describe('PUT /api/groups/:groupId/expenses/:expenseId', () => {
  it('updates splits when exactSplits and correct updatedAt are provided', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/expenses`,
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
      url: `/api/v1/groups/${groupId}/expenses/${expenseId}`,
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
      url: `/api/v1/groups/${groupId}/expenses`,
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
      url: `/api/v1/groups/${groupId}/expenses/${expenseId}`,
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

describe('GET /api/groups/:groupId/expenses/:expenseId', () => {
  let expenseId: string;

  beforeAll(async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });
    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'SingleFetch',
        amountCents: 4200,
        paidByUserId: owner.id,
        date: '2026-06-01',
      },
    });
    expenseId = res.json().id as string;
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/expenses/${expenseId}`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns the expense with all expected fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/expenses/${expenseId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(expenseId);
    expect(body.description).toBe('SingleFetch');
    expect(body.amountCents).toBe(4200);
    expect(typeof body.originalAmountCents).toBe('number');
    expect(typeof body.originalCurrency).toBe('string');
  });

  it('returns 404 for a non-existent expense id', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/expenses/nonexistent-id-000`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe('DELETE /api/groups/:groupId/expenses/:expenseId', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}/expenses/some-id`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('deletes the expense and returns 204; expense no longer in list', async () => {
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: 'test-exp-owner@evenup.local' },
    });

    const createRes = await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'ToDelete',
        amountCents: 1500,
        paidByUserId: owner.id,
        date: '2026-06-02',
      },
    });
    expect(createRes.statusCode).toBe(201);
    const deleteId = createRes.json().id as string;

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/groups/${groupId}/expenses/${deleteId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(deleteRes.statusCode).toBe(204);

    // Verify the expense no longer exists via GET single
    const getRes = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${groupId}/expenses/${deleteId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(getRes.statusCode).toBe(404);
  });
});

describe('GET /api/groups/:groupId/expenses/export', () => {
  // Isolated group/users: the shared group above has exactly one member, which
  // several 'equal'-split tests rely on — adding a second member there would
  // silently change those splits.
  let exportGroupId: string;
  let ownerId: string;
  let ownerToken: string;
  let otherId: string;
  let thirdId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'test-exp-export-' } } });

    const owner = await prisma.user.create({
      data: {
        id: '44444444-4444-4444-4444-444444444444',
        email: 'test-exp-export-owner@evenup.local',
        name: 'Export Owner',
      },
    });
    ownerId = owner.id;
    ownerToken = createTestToken({ sub: owner.id, email: owner.email, name: owner.name });

    const other = await prisma.user.create({
      data: {
        id: '55555555-5555-5555-5555-555555555555',
        email: 'test-exp-export-other@evenup.local',
        name: 'Export Other',
      },
    });
    otherId = other.id;

    const third = await prisma.user.create({
      data: {
        id: '77777777-7777-7777-7777-777777777777',
        email: 'test-exp-export-third@evenup.local',
        name: 'Export Third',
      },
    });
    thirdId = third.id;

    const groupRes = await app.inject({
      method: 'POST',
      url: '/api/v1/groups',
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { name: 'Export Test Group' },
    });
    exportGroupId = groupRes.json().id;
    await prisma.groupMember.create({
      data: { groupId: exportGroupId, userId: other.id, role: 'member' },
    });
    await prisma.groupMember.create({
      data: { groupId: exportGroupId, userId: third.id, role: 'member' },
    });

    await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${exportGroupId}/expenses`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        description: 'Dinner',
        amountCents: 4000,
        paidByUserId: owner.id,
        date: '2026-02-01',
        splitMode: 'exact',
        exactSplits: [
          { userId: owner.id, owedCents: 1000 },
          { userId: other.id, owedCents: 3000 },
        ],
      },
    });

    // 'equal' mode across 3 members on an amount not evenly divisible by 3: the
    // server computes Math.round(5000/3) = 1667 for every member with no remainder
    // correction (apps/api/src/services/computeSplits.ts), so the stored splits sum
    // to 5001 — 1 cent more than amountCents. This is real, accepted drift the export
    // schema must tolerate rather than reject.
    await app.inject({
      method: 'POST',
      url: `/api/v1/groups/${exportGroupId}/expenses`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: {
        description: 'Groceries',
        amountCents: 5000,
        paidByUserId: owner.id,
        date: '2026-02-02',
        splitMode: 'equal',
      },
    });
  });

  afterAll(async () => {
    await prisma.group.deleteMany({ where: { name: 'Export Test Group' } });
    await prisma.user.deleteMany({ where: { email: { startsWith: 'test-exp-export-' } } });
  });

  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${exportGroupId}/expenses/export`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 403 for a non-member', async () => {
    const outsider = await prisma.user.create({
      data: {
        id: '66666666-6666-6666-6666-666666666666',
        email: 'test-exp-export-outsider@evenup.local',
        name: 'Outsider',
      },
    });
    const outsiderToken = createTestToken({
      sub: outsider.id,
      email: outsider.email,
      name: outsider.name,
    });

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${exportGroupId}/expenses/export`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(res.statusCode).toBe(403);

    await prisma.user.delete({ where: { id: outsider.id } });
  });

  it('returns CSV in the same wide, email-keyed format expense import reads, excluding line items', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${exportGroupId}/expenses/export`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('.csv');

    const lines = res.body.trim().split('\n');
    // Member columns are emails (sorted), not names or ids — matches import's format.
    expect(lines[0]).toBe(
      'Date,Description,Cost,test-exp-export-other@evenup.local,test-exp-export-owner@evenup.local,test-exp-export-third@evenup.local',
    );

    const dataLines = lines.slice(1);
    expect(dataLines).toHaveLength(2);

    const dinnerCols = dataLines.find((l) => l.includes('Dinner'))!.split(',');
    expect(dinnerCols).toHaveLength(6);
    expect(dinnerCols[0]).toBe('2026-02-01');
    expect(dinnerCols[2]).toBe('40.00'); // total cost
    expect(dinnerCols[3]).toBe('-30.00'); // other: owes their 30.00 share
    expect(dinnerCols[4]).toBe('30.00'); // owner: paid 40.00, owns only 10.00 → owed 30.00 back
    expect(dinnerCols[5]).toBe('0.00'); // third: not involved in this expense at all

    // No name, id, or line-item-related data leaks into the export.
    expect(res.body).not.toContain('Export Owner');
    expect(res.body).not.toContain('Export Other');
    expect(res.body).not.toContain(ownerId);
    expect(res.body).not.toContain(otherId);
    expect(res.body).not.toContain(thirdId);
    expect(res.body).not.toContain('ReceiptLineItem');
    expect(res.body).not.toContain('lineItems');
  });

  it('exports an equal-mode split whose stored owedCents sum drifts by a rounding cent, instead of failing validation', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/groups/${exportGroupId}/expenses/export`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });

    expect(res.statusCode).toBe(200); // this used to 400 "Ungültige Eingabe" before the fix
    const lines = res.body.trim().split('\n');
    const groceriesCols = lines.find((l) => l.includes('Groceries'))!.split(',');
    expect(groceriesCols[2]).toBe('50.00'); // total cost
    // 1667 owed each (Math.round(5000/3), no remainder correction) — owner is owed
    // back 5000-1667=3333 (33.33), each non-payer owes 1667 (-16.67).
    expect(groceriesCols[3]).toBe('-16.67'); // other
    expect(groceriesCols[4]).toBe('33.33'); // owner
    expect(groceriesCols[5]).toBe('-16.67'); // third
  });
});
