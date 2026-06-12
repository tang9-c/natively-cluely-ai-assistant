import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'electron',
    },
  ],
  webServer: {
    command: 'npm run build:electron && npm run dev',
    url: 'http://localhost:5180',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
