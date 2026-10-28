import { test as base, expect } from '@playwright/test';
import { _electron as electron } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import { initialOnboardingSettings, type OnboardingMode, type OnboardingScenario } from './onboarding-fixtures';
import { offlineElectronEnv, prepareOfflineElectronGuard, verifyOfflineElectronGuard } from './offlineElectronGuard.mjs';

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

async function closeElectronApp(electronApp: ElectronApplication, child: ReturnType<ElectronApplication['process']>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
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

interface AppSession {
  app: ElectronApplication;
  page: Page;
  restart(): Promise<{ electronApp: ElectronApplication; page: Page }>;
}
interface OnboardingOptions { onboardingMode: OnboardingMode; onboardingScenario: OnboardingScenario; rendererMode: 'development' | 'production' }
export const test = base.extend<OnboardingOptions & {
  _session: AppSession;
  electronApp: ElectronApplication;
  page: Page;
  restartApp: () => Promise<{ electronApp: ElectronApplication; page: Page }>;
}>({
  rendererMode: ['development', { option: true }],
  onboardingMode: ['existing', { option: true }],
  onboardingScenario: ['none', { option: true }],
  _session: async ({ onboardingMode, onboardingScenario, rendererMode }, use, testInfo) => {
    const userDataDir = path.join(await fs.realpath(os.tmpdir()), 'natively-e2e', `user-data-${testInfo.testId}`);
    await fs.rm(userDataDir, { recursive: true, force: true });
    await fs.mkdir(userDataDir, { recursive: true });
    const startupOutput: string[] = [];
    let current: ElectronApplication | undefined;
    try {
      await fs.symlink(path.join(process.cwd(), 'node_modules'), path.join(userDataDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
      const boundaryGuard = await prepareOfflineElectronGuard(userDataDir);
      // Upgrade evidence exists before any renderer can initialize origin.
      await fs.writeFile(path.join(userDataDir, 'settings.json'), JSON.stringify(initialOnboardingSettings(onboardingMode, onboardingScenario)));
      const start = async () => {
        const app = await electron.launch({
          args: ['-r', boundaryGuard, process.cwd(), `--user-data-dir=${userDataDir}`], cwd: userDataDir,
          env: { ...offlineElectronEnv(userDataDir), NODE_ENV: rendererMode, ...(onboardingScenario === 'none' ? {} : {
            ELECTRON_E2E_ONBOARDING_FIXTURES: '1', ELECTRON_E2E_ONBOARDING_SCENARIO: onboardingScenario,
          }) },
        });
        current = app;
        if (testInfo.title.includes('startup quit')) {
          app.process().stdout?.on('data', chunk => startupOutput.push(String(chunk)));
          app.process().stderr?.on('data', chunk => startupOutput.push(String(chunk)));
        }
        await verifyOfflineElectronGuard(app, userDataDir);
        const page = await findLauncherPage(app);
        await page.waitForLoadState('domcontentloaded');
        await page.waitForFunction(() => typeof window.electronAPI?.getOnboardingState === 'function');
        if (onboardingMode === 'existing') {
          await page.evaluate(() => {
            localStorage.setItem('natively_seen_startup_v1', 'true');
            localStorage.setItem('natively_perms_shown_v1', '1');
          });
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForSelector('#launcher-container, button[aria-label="启动会议"]', { timeout: 15000 });
        }
        return { app, page };
      };
      const first = await start();
      const session: AppSession = {
        ...first,
        restart: async () => {
          await session.app.evaluate(({ session }) => { session.defaultSession.flushStorageData(); });
          await closeElectronApp(session.app, session.app.process());
          const next = await start(); session.app = next.app; session.page = next.page;
          return { electronApp: next.app, page: next.page };
        },
      };
      await use(session);
    } finally {
      if (current) await closeElectronApp(current, current.process());
      if (testInfo.title.includes('startup quit')) {
        await fs.mkdir(path.join(process.cwd(), '.tmp/v28-t7'), { recursive: true });
        await fs.writeFile(path.join(process.cwd(), '.tmp/v28-t7/startup-main.log'), startupOutput.join(''));
      }
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    }
  },
  electronApp: async ({ _session }, use) => use(_session.app),
  page: async ({ _session }, use) => use(_session.page),
  restartApp: async ({ _session }, use) => use(() => _session.restart()),
});

export { expect };
