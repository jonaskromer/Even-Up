import type { Page } from '@playwright/test';

const FAKE_USER = {
  id: 'e2e-test-user-id',
  email: 'e2e@evenup.local',
  name: 'E2E Test User',
};

/**
 * Mocks an authenticated session for E2E tests.
 *
 * With the BFF architecture, auth state lives entirely in HttpOnly cookies that
 * the browser manages — there is no client-side token to inject. Instead we
 * intercept the two network calls that establish auth state:
 *
 *  1. GET /api/auth/me  — called by AuthContext on mount; we return a fake user.
 *  2. GET /api/auth/**  — intercept any other auth checks (logout, etc.) to no-op.
 *
 * No Storage patching needed.
 */
export async function mockAuthedUser(page: Page): Promise<void> {
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ user: FAKE_USER }),
    }),
  );
}

/** Intercepts a single API path and returns the given body as JSON. */
export async function mockApi(page: Page, path: string, body: unknown): Promise<void> {
  await page.route(`**${path}`, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    }),
  );
}
