// tests/e2e/basic-smoke.spec.ts
//
// FINDING-006: Playwright E2E smoke tests for Natively.
//
// This file exercises the renderer → main-process IPC contract that
// service-level tests cannot cover. Each test opens the actual Electron
// window and asserts on real UI state.
//
// To run locally:
//   npm run test:e2e

import { test, expect } from './fixtures';

const CI = process.env.CI === 'true';

test.describe('FINDING-006: Natively E2E smoke', () => {
  test.beforeEach(async () => {
    if (CI) {
      test.skip();
    }
  });

  test('app window loads without crash', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => {
      if (m.type() === 'error') errors.push(m.text());
    });

    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // allow async init

    const crashIndicators = ['is not defined', 'Cannot find module', 'Electron Error'];
    const criticalErrors = errors.filter(e => crashIndicators.some(ci => e.includes(ci)));
    expect(criticalErrors, `Critical errors: ${criticalErrors.join(' | ')}`).toHaveLength(0);
  });

  test('main IPC channel responds to ping', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // The preload bridge exposes window.electronAPI with a real IPC function.
    const hasPreload = await page.evaluate(() => {
      const api = (window as any).electronAPI;
      return typeof api === 'object' && typeof api.getProviderDataScopes === 'function';
    });

    // A missing preload is a failure — the IPC contract is broken.
    expect(hasPreload).toBe(true);
  });

  test('modes IPC returns the default mode list', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const modes = await page.evaluate(async () => {
      const api = (window as any).electronAPI;
      return api?.modesGetAll?.();
    });

    expect(Array.isArray(modes)).toBe(true);
    const templateTypes = modes.map((mode: { templateType: string }) => mode.templateType);
    expect(templateTypes).toEqual(expect.arrayContaining([
      'general',
      'sales',
      'fde',
      'recruiting',
      'team-meet',
      'looking-for-work',
      'technical-interview',
      'lecture',
    ]));
  });

  test('settings panel opens and closes', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    const settingsBtn = page
      .locator('[data-testid="launcher-settings-button"], button[aria-label="打开设置"], button[title="设置"]')
      .first();
    await expect(settingsBtn, 'Launcher Settings button should be reachable').toBeVisible();

    await settingsBtn.click();
    const settingsPanel = page.locator('#settings-panel');
    await expect(settingsPanel, 'Settings panel should open from Launcher').toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: /关闭/ }).first().click();
    await expect(settingsPanel, 'Settings panel should close from its close action').toBeHidden({ timeout: 5_000 });
  });
});
