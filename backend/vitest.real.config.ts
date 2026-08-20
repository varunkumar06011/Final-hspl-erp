import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/e2e-real-*.test.ts'],
    setupFiles: ['tests/setup-real.ts'],
    testTimeout: 30000,
    hookTimeout: 60000,
  },
  resolve: {
    alias: {
      '@hospital-erp/shared': path.resolve(__dirname, '../shared'),
    },
  },
});
