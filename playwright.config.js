import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './tests',
  testMatch: 'browser.spec.js',
  timeout: 90000,
  expect: { timeout: 60000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    channel: process.env.PALM_TEST_BROWSER || 'chrome',
    viewport: { width: 1280, height: 1000 },
    launchOptions: { args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${path.resolve('tests/fixtures/palm.y4m')}`,
    ] },
  },
  webServer: {
    command: 'npm run preview',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 30000,
  },
});
