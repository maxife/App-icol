import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const sharedEntry = path.resolve(rootDir, 'packages/shared/src/index.ts');

export default defineConfig({
  resolve: {
    alias: {
      '@app-icol/shared': sharedEntry,
    },
  },
  test: {
    passWithNoTests: false,
    projects: [
      {
        extends: true,
        test: {
          name: 'shared',
          environment: 'node',
          include: ['packages/shared/src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        test: {
          name: 'gas-api',
          environment: 'node',
          include: ['packages/gas-api/src/**/*.test.ts'],
        },
      },
      {
        extends: true,
        plugins: [react()],
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['packages/web/src/**/*.test.{ts,tsx}'],
          setupFiles: ['packages/web/src/test/setup.ts'],
          css: true,
        },
      },
    ],
  },
});
