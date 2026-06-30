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

let ownerToken: string;
let inviteeToken: string;
let inviteeId: string;
let outsiderToken: string;
let groupId: string;

beforeAll(async () => {
  await app.ready();
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-joinreq-' } } });

  const owner = await prisma.user.create({
    data: {
      id: '66666666-6666-6666-6666-666666666666',
      email: 'test-joinreq-owner@evenup.local',
      name: 'Owner',
    },
  });
  ownerToken = createTestToken({ sub: owner.id, email: owner.email, name: owner.name });

  const invitee = await prisma.user.create({
    data: {
      id: '77777777-7777-7777-7777-777777777777',
      email: 'test-joinreq-invitee@evenup.local',
      name: 'Invitee',
    },
  });
  inviteeToken = createTestToken({ sub: invitee.id, email: invitee.email, name: invitee.name });
  inviteeId = invitee.id;

  const outsider = await prisma.user.create({
    data: {
      id: '88888888-8888-8888-8888-888888888888',
      email: 'test-joinreq-outsider@evenup.local',
      name: 'Outsider',
    },
  });
  outsiderToken = createTestToken({
    sub: outsider.id,
    email: outsider.email,
    name: outsider.name,
  });

  const groupRes = await app.inject({
    method: 'POST',
    url: '/api/groups',
    headers: { authorization: `Bearer ${ownerToken}` },
    payload: { name: 'JoinRequest Test Group' },
  });
  groupId = groupRes.json().id;
});

afterAll(async () => {
  await prisma.group.deleteMany({ where: { name: 'JoinRequest Test Group' } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'test-joinreq-' } } });
  await prisma.$disconnect();
  await app.close();
});

describe('POST /api/groups/:id/members', () => {
  it('creates a pending join request instead of adding the member directly', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'test-joinreq-invitee@evenup.local' },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().message).toBe('Anfrage gesendet');

    const group = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const memberIds = group.json().members.map((m: { id: string }) => m.id);
    expect(memberIds).not.toContain(inviteeId);

    const request = await prisma.groupJoinRequest.findFirst({
      where: { groupId, invitedUserId: inviteeId },
    });
    expect(request?.status).toBe('pending');
  });

  it('rejects a duplicate invite while one is already pending', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'test-joinreq-invitee@evenup.local' },
    });

    expect(res.statusCode).toBe(409);
  });

  it('rejects inviting yourself', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'test-joinreq-owner@evenup.local' },
    });

    expect(res.statusCode).toBe(400);
  });
});

describe('GET /api/join-requests', () => {
  it("lists the invitee's pending request with group and inviter names", async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/join-requests',
      headers: { authorization: `Bearer ${inviteeToken}` },
    });

    expect(res.statusCode).toBe(200);
    const requests = res.json();
    const match = requests.find((r: { groupId: string }) => r.groupId === groupId);
    expect(match).toBeDefined();
    expect(match.groupName).toBe('JoinRequest Test Group');
    expect(match.invitedByName).toBe('Owner');
  });
});

describe('POST /api/join-requests/:id/accept', () => {
  it('rejects acceptance by someone other than the invitee', async () => {
    const request = await prisma.groupJoinRequest.findFirstOrThrow({
      where: { groupId, invitedUserId: inviteeId, status: 'pending' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/join-requests/${request.id}/accept`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it('adds the invitee as a member and rejects inviting them again', async () => {
    const request = await prisma.groupJoinRequest.findFirstOrThrow({
      where: { groupId, invitedUserId: inviteeId, status: 'pending' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/join-requests/${request.id}/accept`,
      headers: { authorization: `Bearer ${inviteeToken}` },
    });

    expect(res.statusCode).toBe(200);

    const group = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const memberIds = group.json().members.map((m: { id: string }) => m.id);
    expect(memberIds).toContain(inviteeId);

    const updated = await prisma.groupJoinRequest.findUnique({ where: { id: request.id } });
    expect(updated?.status).toBe('accepted');

    // Already a member now -> re-inviting is rejected for a different reason (409 already-member)
    const reinvite = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'test-joinreq-invitee@evenup.local' },
    });
    expect(reinvite.statusCode).toBe(409);
  });
});

describe('POST /api/join-requests/:id/decline', () => {
  it('marks the request declined without creating a membership', async () => {
    const inviteRes = await app.inject({
      method: 'POST',
      url: `/api/groups/${groupId}/members`,
      headers: { authorization: `Bearer ${ownerToken}` },
      payload: { email: 'test-joinreq-outsider@evenup.local' },
    });
    expect(inviteRes.statusCode).toBe(201);

    const request = await prisma.groupJoinRequest.findFirstOrThrow({
      where: { groupId, invitedUserId: { not: inviteeId }, status: 'pending' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/join-requests/${request.id}/decline`,
      headers: { authorization: `Bearer ${outsiderToken}` },
    });

    expect(res.statusCode).toBe(200);

    const updated = await prisma.groupJoinRequest.findUnique({ where: { id: request.id } });
    expect(updated?.status).toBe('declined');

    const group = await app.inject({
      method: 'GET',
      url: `/api/groups/${groupId}`,
      headers: { authorization: `Bearer ${ownerToken}` },
    });
    const memberIds = group.json().members.map((m: { id: string }) => m.id);
    expect(memberIds).not.toContain(updated?.invitedUserId);
  });
});
