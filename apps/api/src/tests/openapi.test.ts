import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from './app.js';

const app = createApp();

beforeAll(async () => {
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('OpenAPI / Swagger', () => {
  it('serves the raw OpenAPI document with no auth required', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.statusCode).toBe(200);

    const doc = res.json();
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.paths['/groups']).toBeDefined();
    expect(doc.paths['/groups/{groupId}/expenses/export']).toBeDefined();
  });

  it('reuses the real Zod request-body schema for a documented endpoint', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    const doc = res.json();

    const createExpense = doc.components.schemas.CreateExpense;
    expect(createExpense.type).toBe('object');
    expect(createExpense.properties.description).toBeDefined();
    expect(createExpense.properties.amountCents).toBeDefined();
  });

  it('serves the Swagger UI page', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/docs' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });
});

describe('API versioning', () => {
  it('serves business endpoints under /api/v1', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/groups' });
    // Unauthenticated, but reaching the route (401) proves it's registered at this path.
    expect(res.statusCode).toBe(401);
  });

  it('keeps /api/health unversioned', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('does not serve business endpoints at the old unversioned /api path', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/groups' });
    expect(res.statusCode).toBe(404);
  });
});
