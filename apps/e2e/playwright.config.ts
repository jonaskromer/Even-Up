import { defineConfig, devices } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parse } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load root .env in local dev; in CI env vars come from the workflow.
// ??= means already-set vars (CI secrets) take priority over the file.
try {
  const env = parse(readFileSync(resolve(__dirname, '../../.env'), 'utf-8'));
  for (const [k, v] of Object.entries(env)) {
    process.env[k] ??= v;
  }
} catch {
  // .env not present — fine in CI
}

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'html',
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    locale: 'de-DE',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Starts the Vite dev server; reuses it if already running locally.
    // VITE_API_URL='' makes all /api/* calls relative so Playwright can intercept them.
    // cd to monorepo root first — npm can't resolve --workspace from apps/e2e.
    command: 'cd ../.. && npm run dev --workspace=apps/web',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? 'https://placeholder.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'placeholder-key',
      VITE_API_URL: '',
    },
  },
});
