import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createApp } from './app.js';
import { prisma } from '../db/prisma.js';
import { createTestToken } from './authTestHelpers.js';

// Mirrors expenses.test.ts's authService mock — no real Supabase JWT verification.
vi.mock('../services/authService.js', () => ({
  verifyToken: async (token: string) =>
    JSON.parse(Buffer.from(token, 'base64url').toString('utf-8')),
}));

// Isolate route/persistence logic from the real Gemini API — parsing itself is
// covered by geminiReceipt.test.ts.
vi.mock('../services/geminiReceiptService.js', () => ({
  isReceiptParsingEnabled: () => true,
  parseReceiptImage: vi.fn(async () => ({
    storeName: 'Test Store',
    date: '2026-06-01',
    lineItems: [{ name: 'Item A', quantity: 1, priceCents: 1000 }],
    subtotalCents: 1000,
    grandTotalCents: 1000,
  })),
}));

function parseNdjson(payload: string): { type: string; [key: string]: unknown }[] {
  return payload
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function buildMultipartBody(
  fieldName: string,
  filename: string,
  contentType: string,
  content: Buffer,
): { body: Buffer; boundary: string } {
  const boundary = '----testBoundary123';
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldName}"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return { body, boundary };
}

const app = createApp();

let token: string;
let ownerId: string;
let otherId: string;
let groupId: string;

beforeAll(async () => {
  await app.ready();
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-receipt-' } } });

  const owner = await prisma.user.create({
    data: {
      id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      email: 'test-receipt-owner@evenup.local',
      name: 'Owner',
    },
  });
  ownerId = owner.id;
  token = createTestToken({ sub: owner.id, email: owner.email, name: owner.name });

  const other = await prisma.user.create({
    data: {
      id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
      email: 'test-receipt-other@evenup.local',
      name: 'Other',
    },
  });
  otherId = other.id;

  const groupRes = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { authorization: `Bearer ${token}` },
    payload: { name: 'Receipt Test Group' },
  });
  groupId = groupRes.json().id;

  await prisma.groupMember.create({ data: { groupId, userId: other.id, role: 'member' } });
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { name: 'Receipt Test Group' } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-receipt-' } } });
  await prisma.$disconnect();
  await app.close();
});

describe('POST /api/groups/:groupId/receipts/parse', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts/parse`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('parses an uploaded image and returns the structured result', async () => {
    const { body, boundary } = buildMultipartBody(
      'file',
      'receipt.jpg',
      'image/jpeg',
      Buffer.from('fake-image-bytes'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts/parse`,
      headers: {
        authorization: `Bearer ${token}`,
        origin: 'http://localhost:5173',
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('application/x-ndjson');
    // reply.hijack() bypasses Fastify's normal reply finalization, so headers staged
    // by other plugins (like @fastify/cors) must be explicitly re-applied — regression
    // test for a bug where the CORS header was silently dropped on this streamed route.
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const events = parseNdjson(res.payload);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: 'result',
      data: {
        storeName: 'Test Store',
        date: '2026-06-01',
        lineItems: [{ name: 'Item A', quantity: 1, priceCents: 1000 }],
        subtotalCents: 1000,
        grandTotalCents: 1000,
      },
    });
  });

  it('streams progress events before the final result', async () => {
    const { parseReceiptImage } = await import('../services/geminiReceiptService.js');
    vi.mocked(parseReceiptImage).mockImplementationOnce(async (_b64, _mime, onProgress) => {
      onProgress?.({ model: 'primary', attempt: 1, attempts: 3 });
      onProgress?.({ model: 'secondary', attempt: 1, attempts: 1 });
      return {
        storeName: 'Test Store',
        lineItems: [{ name: 'Item A', quantity: 1, priceCents: 1000 }],
        grandTotalCents: 1000,
      };
    });

    const { body, boundary } = buildMultipartBody(
      'file',
      'receipt.jpg',
      'image/jpeg',
      Buffer.from('fake-image-bytes'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts/parse`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const events = parseNdjson(res.payload);
    expect(events).toHaveLength(3);
    expect(events[0]).toEqual({ type: 'progress', model: 'primary', attempt: 1, attempts: 3 });
    expect(events[1]).toEqual({ type: 'progress', model: 'secondary', attempt: 1, attempts: 1 });
    expect(events[2].type).toBe('result');
  });

  it('streams an error event when parsing ultimately fails', async () => {
    const { parseReceiptImage } = await import('../services/geminiReceiptService.js');
    const { HttpError } = await import('../lib/HttpError.js');
    vi.mocked(parseReceiptImage).mockRejectedValueOnce(
      new HttpError(503, 'Beleg konnte nicht analysiert werden.'),
    );

    const { body, boundary } = buildMultipartBody(
      'file',
      'receipt.jpg',
      'image/jpeg',
      Buffer.from('fake-image-bytes'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts/parse`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    const events = parseNdjson(res.payload);
    expect(events).toEqual([
      { type: 'error', status: 503, message: 'Beleg konnte nicht analysiert werden.' },
    ]);
  });

  it('rejects non-image files with 400', async () => {
    const { body, boundary } = buildMultipartBody(
      'file',
      'notes.txt',
      'text/plain',
      Buffer.from('not an image'),
    );

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts/parse`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: body,
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('POST /api/groups/:groupId/receipts', () => {
  it('returns 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      payload: {},
    });
    expect(res.statusCode).toBe(401);
  });

  it('creates one expense with line items and correctly split assignments', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Rewe',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Milch',
            quantity: 1,
            priceCents: 200,
            excluded: false,
            assignments: [
              { userId: ownerId, weight: 1 },
              { userId: otherId, weight: 1 },
            ],
          },
          {
            name: 'Pfand-Rückgabe',
            quantity: 1,
            priceCents: -150,
            excluded: true,
            assignments: [],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.description).toBe('Rewe');
    expect(body.receiptStoreName).toBe('Rewe');
    // Only the non-excluded item (200) counts toward the total; the excluded
    // -150 refund line is ignored entirely.
    expect(body.amountCents).toBe(200);
    expect(body.splitMode).toBe('exact');

    const splits = body.splits as { userId: string; owedCents: number }[];
    expect(splits).toHaveLength(2);
    const sum = splits.reduce((s: number, sp: { owedCents: number }) => s + sp.owedCents, 0);
    expect(sum).toBe(200);

    expect(body.lineItems).toHaveLength(2);
    const excludedItem = body.lineItems.find((li: { excluded: boolean }) => li.excluded);
    expect(excludedItem.name).toBe('Pfand-Rückgabe');
    expect(excludedItem.assignments).toHaveLength(0);

    const includedItem = body.lineItems.find((li: { excluded: boolean }) => !li.excluded);
    expect(includedItem.assignments).toHaveLength(2);
  });

  it('supports per-item exact split mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Exact Split',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Pizza',
            quantity: 1,
            priceCents: 1000,
            excluded: false,
            splitMode: 'exact',
            assignments: [
              { userId: ownerId, weight: 1, exactCents: 700 },
              { userId: otherId, weight: 1, exactCents: 300 },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.amountCents).toBe(1000);
    const splits = body.splits as { userId: string; owedCents: number }[];
    expect(splits.find((s) => s.userId === ownerId)?.owedCents).toBe(700);
    expect(splits.find((s) => s.userId === otherId)?.owedCents).toBe(300);
    expect(body.lineItems[0].splitMode).toBe('exact');
  });

  it('returns 422 when per-item exact amounts do not sum to the item price', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Bad Exact Split',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Pizza',
            quantity: 1,
            priceCents: 1000,
            excluded: false,
            splitMode: 'exact',
            assignments: [
              { userId: ownerId, weight: 1, exactCents: 700 },
              { userId: otherId, weight: 1, exactCents: 100 },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(422);
  });

  it('supports per-item percent split mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Percent Split',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Wine',
            quantity: 1,
            priceCents: 2000,
            excluded: false,
            splitMode: 'percent',
            assignments: [
              { userId: ownerId, weight: 1, percent: 25 },
              { userId: otherId, weight: 1, percent: 75 },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    const splits = body.splits as { userId: string; owedCents: number }[];
    expect(splits.find((s) => s.userId === ownerId)?.owedCents).toBe(500);
    expect(splits.find((s) => s.userId === otherId)?.owedCents).toBe(1500);
  });

  it('returns 422 when per-item percentages do not sum to 100', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Bad Percent Split',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Wine',
            quantity: 1,
            priceCents: 2000,
            excluded: false,
            splitMode: 'percent',
            assignments: [
              { userId: ownerId, weight: 1, percent: 25 },
              { userId: otherId, weight: 1, percent: 50 },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(422);
  });

  it('supports per-item equal split mode', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Equal Split',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Fries',
            quantity: 1,
            priceCents: 301,
            excluded: false,
            splitMode: 'equal',
            assignments: [
              { userId: ownerId, weight: 1 },
              { userId: otherId, weight: 1 },
            ],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const splits = res.json().splits as { userId: string; owedCents: number }[];
    const sum = splits.reduce((s, sp) => s + sp.owedCents, 0);
    expect(sum).toBe(301);
    // 301 split two ways: 150 + 151 (remainder on the last assignee)
    expect(splits.map((s) => s.owedCents).sort()).toEqual([150, 151]);
  });

  it('returns 422 when an assignment references a non-member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Bad Assignment',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Item',
            quantity: 1,
            priceCents: 500,
            excluded: false,
            assignments: [{ userId: 'not-a-member-id', weight: 1 }],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(422);
  });
});

describe('PUT /api/groups/:groupId/receipts/:expenseId', () => {
  it('replaces line items and splits (delete-all + create-many semantics)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Edit Me',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Original Item',
            quantity: 1,
            priceCents: 1000,
            excluded: false,
            assignments: [{ userId: ownerId, weight: 1 }],
          },
        ],
      },
    });
    expect(createRes.statusCode).toBe(201);
    const { id: expenseId, updatedAt } = createRes.json() as { id: string; updatedAt: string };

    const updateRes = await app.inject({
      method: 'PUT',
      url: `/api/groups/${groupId}/receipts/${expenseId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Edit Me',
        paidByUserId: ownerId,
        date: '2026-06-01',
        updatedAt,
        lineItems: [
          {
            name: 'Replaced Item',
            quantity: 2,
            priceCents: 400,
            excluded: false,
            assignments: [
              { userId: ownerId, weight: 1 },
              { userId: otherId, weight: 1 },
            ],
          },
        ],
      },
    });

    expect(updateRes.statusCode).toBe(200);
    const body = updateRes.json();
    expect(body.amountCents).toBe(400);
    expect(body.lineItems).toHaveLength(1);
    expect(body.lineItems[0].name).toBe('Replaced Item');
    expect(body.lineItems[0].assignments).toHaveLength(2);
  });

  it('returns 403 for a non-member', async () => {
    const outsiderToken = createTestToken({
      sub: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      email: 'test-receipt-outsider@evenup.local',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${outsiderToken}` },
      payload: {
        storeName: 'X',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Item',
            quantity: 1,
            priceCents: 500,
            excluded: false,
            assignments: [{ userId: ownerId, weight: 1 }],
          },
        ],
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe('GET /api/groups/:groupId/expenses/:expenseId — lineItems inclusion', () => {
  it('includes lineItems/assignments for a receipt-created expense', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/receipts`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        storeName: 'Fetch Me',
        paidByUserId: ownerId,
        date: '2026-06-01',
        lineItems: [
          {
            name: 'Item',
            quantity: 1,
            priceCents: 500,
            excluded: false,
            assignments: [{ userId: ownerId, weight: 1 }],
          },
        ],
      },
    });
    const expenseId = createRes.json().id as string;

    const res = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}/expenses/${expenseId}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.receiptStoreName).toBe('Fetch Me');
    expect(body.lineItems).toHaveLength(1);
    expect(body.lineItems[0].assignments).toEqual([{ userId: ownerId, weight: 1 }]);
  });

  it('returns an empty lineItems array for a plain expense', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/expenses`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        description: 'Plain expense',
        amountCents: 1000,
        paidByUserId: ownerId,
        date: '2026-06-01',
      },
    });
    expect(res.json().lineItems).toEqual([]);
  });
});
