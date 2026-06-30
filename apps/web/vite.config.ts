import path from 'node:path';
import { reactRouter } from '@react-router/dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [reactRouter()],
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: {
      '~': path.resolve(__dirname, 'app'),
    },
  },
  server: { port: 5173, open: true, host: true },
});
