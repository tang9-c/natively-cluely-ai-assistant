import { test as base, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';

async function findLauncherPage(electronApp: ElectronApplication): Promise<Page> {
  const deadline = Date.now() + 15_000;
  let fallback: Page | null = null;

  while (Date.now() < deadline) {
    const windows = electronApp.windows();
    fallback = fallback ?? windows[0] ?? null;

    for (const candidate of windows) {
      await candidate.waitForLoadState('domcontentloaded', { timeout: 2_000 }).catch(() => {});
      const url = candidate.url();
      let isDefaultWindow = false;
      try {
        isDefaultWindow = !new URL(url).searchParams.has('window');
      } catch {
        isDefaultWindow = false;
      }
      if (url.includes('window=launcher') || isDefaultWindow) {
        return candidate;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (fallback) return fallback;
  return electronApp.firstWindow();
}

async function closeElectronApp(electronApp: ElectronApplication): Promise<void> {
  const child = electronApp.process();
  const waitForExit = new Promise<void>((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve();
      return;
    }
    child.once('exit', () => resolve());
  });

  await Promise.race([
    electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {}),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);

  const exited = await Promise.race([
    waitForExit.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000)),
  ]);

  if (!exited && child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
  }
}

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
        ELECTRON_E2E_SKIP_AUDIO_START: '1',
      },
    });

    await use(app);

    await closeElectronApp(app);
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
  },

  // Reuse the first (launcher) window created by the Electron app.
  page: async ({ electronApp }, use) => {
    const page = await findLauncherPage(electronApp);
    await page.waitForLoadState('domcontentloaded');

    // Most E2E specs exercise the steady-state launcher, not first-run
    // onboarding. Persist those one-shot flags and reload the launcher so tests
    // don't race the welcome/permissions transition on a fresh user-data-dir.
    await page.evaluate(() => {
      window.localStorage.setItem('natively_seen_startup_v1', 'true');
      window.localStorage.setItem('natively_perms_shown_v1', '1');
    });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#launcher-container, button[aria-label="启动会议"]', {
      timeout: 10_000,
    });

    await use(page);
  },
});

export { expect };
