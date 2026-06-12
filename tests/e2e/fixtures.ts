import { test as base, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

export const test = base.extend<{
  electronApp: ElectronApplication;
  page: Page;
}>({
  // Launch the real Electron main process for each test.
  // A fresh user-data-dir isolates tests and avoids single-instance-lock
  // collisions when tests run back-to-back.
  electronApp: async ({}, use, testInfo) => {
    const userDataDir = path.join(
      os.tmpdir(),
      'natively-e2e',
      `user-data-${testInfo.testId}`,
    );
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });

    const app = await electron.launch({
      args: ['.', `--user-data-dir=${userDataDir}`],
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_ENABLE_LOGGING: '1',
        ELECTRON_E2E: '1',
      },
    });

    await use(app);

    await app.close();
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  },

  // Reuse the first (launcher) window created by the Electron app.
  page: async ({ electronApp }, use) => {
    const page = await electronApp.firstWindow();
    await page.waitForLoadState('domcontentloaded');

    // The app shows a one-time permissions toaster on first launch.
    // Dismiss it so subsequent assertions see the main launcher UI.
    const dismissCta = page.locator('button', { hasText: /继续|准备就绪/ }).first();
    try {
      await dismissCta.waitFor({ state: 'visible', timeout: 3_000 });
      await dismissCta.click();
      await page.waitForTimeout(300);
    } catch {
      // Toaster did not appear; continue.
    }

    await use(page);
  },
});

export { expect };
