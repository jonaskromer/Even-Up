import { test, expect } from '@playwright/test';
import { mockAuthedUser, mockApi } from '../helpers/mockAuth.js';

const NO_ACTIVITIES = { items: [], total: 0 };

test.describe('dashboard (authenticated)', () => {
  test('shows empty state when user has no groups', async ({ page }) => {
    await mockAuthedUser(page);
    await mockApi(page, '/api/groups', []);
    await mockApi(page, '/api/activities', NO_ACTIVITIES);

    await page.goto('/');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText('Erste Gruppe erstellen')).toBeVisible();
  });

  test('renders group list when groups exist', async ({ page }) => {
    await mockAuthedUser(page);
    await mockApi(page, '/api/groups', [
      { id: 'group-1', name: 'Ski Trip 2026', currency: 'EUR', createdAt: '2026-01-01T00:00:00Z', members: [] },
    ]);
    await mockApi(page, '/api/groups/group-1/balances', []);
    await mockApi(page, '/api/activities', NO_ACTIVITIES);

    await page.goto('/');

    await expect(page.getByText('Ski Trip 2026')).toBeVisible();
  });

  test('clicking "Erste Gruppe erstellen" navigates to /groups/new', async ({ page }) => {
    await mockAuthedUser(page);
    await mockApi(page, '/api/groups', []);
    await mockApi(page, '/api/activities', NO_ACTIVITIES);

    await page.goto('/');
    await page.getByRole('button', { name: 'Erste Gruppe erstellen' }).click();

    await expect(page).toHaveURL(/\/groups\/new/);
  });

  test('"Neue Gruppe" header button also navigates to /groups/new', async ({ page }) => {
    await mockAuthedUser(page);
    await mockApi(page, '/api/groups', []);
    await mockApi(page, '/api/activities', NO_ACTIVITIES);

    await page.goto('/');
    await page.getByRole('link', { name: 'Neue Gruppe' }).click();

    await expect(page).toHaveURL(/\/groups\/new/);
  });
});

test.describe('new group page (authenticated)', () => {
  test('renders the group name form', async ({ page }) => {
    await mockAuthedUser(page);

    await page.goto('/groups/new');

    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Gruppe erstellen' })).toBeVisible();
  });
});
