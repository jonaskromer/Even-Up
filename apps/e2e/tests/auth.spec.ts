import { test, expect } from '@playwright/test';

test.describe('unauthenticated routing', () => {
  test('/ redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/groups/new redirects to /login', async ({ page }) => {
    await page.goto('/groups/new');
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe('login page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('renders email and password form', async ({ page }) => {
    await expect(page.getByLabel('E-Mail')).toBeVisible();
    await expect(page.getByLabel('Passwort')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  });

  test('has a link to the register page', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Registrieren' })).toBeVisible();
  });

  test('has a "forgot password" link', async ({ page }) => {
    await expect(page.getByRole('link', { name: 'Passwort vergessen?' })).toBeVisible();
  });

  test('shows an error alert on invalid credentials', async ({ page }) => {
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 401,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Invalid login credentials' }),
      }),
    );

    await page.getByLabel('E-Mail').fill('wrong@example.com');
    await page.getByLabel('Passwort').fill('badpassword');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

    await expect(page.getByRole('alert')).toBeVisible();
  });
});

test.describe('register page', () => {
  test('renders name, email and password fields', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByLabel('Name')).toBeVisible();
    await expect(page.getByLabel('E-Mail')).toBeVisible();
    await expect(page.getByLabel(/Passwort/)).toBeVisible();
  });

  test('has a link back to the login page', async ({ page }) => {
    await page.goto('/register');
    await expect(page.getByRole('link', { name: 'Anmelden' })).toBeVisible();
  });
});
