import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
    setupFiles: [],
    // Root .env lives two levels up since apps/api/.env no longer exists.
    env: loadEnv('test', path.resolve(__dirname, '../..'), ''),
  },
});
