import os from 'node:os';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

const DEFAULT_SCRATCH_BASE = process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, 'app-icol-scratch')
  : path.join(os.homedir(), '.gemini/jetski/scratch/teamwork_tmp');

const rawTmpDir = process.env.TMPDIR;
const safeTmpBase =
  rawTmpDir && !rawTmpDir.startsWith('/tmp')
    ? rawTmpDir
    : path.join(DEFAULT_SCRATCH_BASE, `pw-${process.pid}`);

const port = Number(process.env.E2E_PORT || 4173);
const baseURL = process.env.E2E_BASE_URL || `http://127.0.0.1:${port}`;
const useExternalServer = process.env.E2E_EXTERNAL_SERVER === '1';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  reporter: [['list']],
  outputDir: path.join(safeTmpBase, 'pw-results'),
  use: {
    baseURL,
    browserName: 'chromium',
    headless: true,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    acceptDownloads: true,
    serviceWorkers: 'allow',
    locale: 'fr-FR',
    timezoneId: 'Europe/Paris',
    trace: 'off',
    launchOptions: {
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
      ],
    },
  },
  webServer: useExternalServer
    ? undefined
    : {
        command: `npx vite preview packages/web --config packages/web/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
        url: baseURL,
        reuseExistingServer: false,
        timeout: 30_000,
      },
});
