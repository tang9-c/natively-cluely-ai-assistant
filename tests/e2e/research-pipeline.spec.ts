// tests/e2e/research-pipeline.spec.ts
//
// E2E smoke for the Research Pipeline (公司情报调研) feature.
//
// What this exercises:
//   1. The Settings → Research tab renders the Tavily API key input.
//   2. Dispatching the `open-research-panel` CustomEvent opens the
//      ResearchPanel overlay (verified via the `data-testid="research-panel"`
//      attribute mounted by ResearchPanel.tsx).
//   3. The panel's company-name input is wired: empty input keeps the
//      "立即调研" submit button disabled, filling it enables submit.
//   4. The panel's close button (aria-label="关闭") hides the panel.
//
// Environment notes:
//   * These tests follow the same launcher pattern as `basic-smoke.spec.ts`
//     and `parity-gaps-evidence.spec.ts`, reusing the shared `./fixtures`
//     module so a real Electron window is launched against the bundled
//     main process.
//   * The launch sets `E2E_TAVILY_API_KEY` so the renderer's `useResearch`
//     hook can resolve a key during cold-start; the value is irrelevant to
//     these UI assertions because no submit-and-scrape cycle is performed.
//   * As with the other E2E specs, the whole suite is gated on
//     `ELECTRON_E2E=1` to keep CI smoke runs cheap. Local runs can opt in
//     via `npm run test:e2e -- research-pipeline.spec.ts`.
//
// To run locally:
//   npm run test:e2e -- research-pipeline.spec.ts

import { test, expect } from './fixtures';

const E2E_ENABLED = process.env.ELECTRON_E2E === '1';

test.describe('Research Pipeline E2E', () => {
  test.beforeEach(() => {
    if (!E2E_ENABLED) {
      test.skip(true, 'Set ELECTRON_E2E=1 to run live research-pipeline E2E');
    }
  });

  test('Settings → Research tab shows the Tavily API key input', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Open Settings from the Launcher. This must fail loudly if the entrypoint
    // regresses; otherwise the whole Settings/RAG configuration path can look
    // green while being unreachable in the real app.
    const settingsBtn = page
      .locator('[data-testid="launcher-settings-button"], button[aria-label="打开设置"], button[title="设置"]')
      .first();
    await expect(settingsBtn, 'Launcher Settings button should be reachable').toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('#settings-panel'), 'Settings panel should open from Launcher').toBeVisible({ timeout: 5_000 });

    // The product labels this combined area as "知识源"; it contains network
    // research, uploaded materials, and business-system sources.
    const knowledgeTab = page
      .getByRole('button', { name: /知识源|Research/i })
      .first();
    await expect(knowledgeTab, 'Knowledge/Research settings tab should be reachable').toBeVisible();
    await knowledgeTab.click();

    // The ResearchTabBody renders a password-style Tavily key input. Avoid
    // placeholder matching because a saved key intentionally replaces the
    // placeholder with bullets.
    const tavilyInput = page.getByTestId('network-research-card').locator('input[type="password"]').first();
    await expect(tavilyInput).toBeVisible();
  });

  test('Dispatching open-research-panel opens the ResearchPanel overlay', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // The App.tsx event listener wires `open-research-panel` to set
    // isResearchPanelOpen=true with optional `companyName` in detail.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('open-research-panel', {
          detail: { companyName: 'Apple Inc.' },
        }),
      );
    });

    const panel = page.getByTestId('research-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });
  });

  test('ResearchPanel input gates the submit button on emptiness', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Open the panel with no initial company name to verify the empty state.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('open-research-panel', {
          detail: { companyName: '' },
        }),
      );
    });

    const panel = page.getByTestId('research-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // ResearchInput uses aria-label="公司名称" for the text input.
    const input = page.getByLabel('公司名称');
    await expect(input).toBeVisible();

    // Submit button text is "立即调研" while idle, "调研中..." while loading.
    const submit = page.getByRole('button', { name: /立即调研/ });
    await expect(submit).toBeDisabled();

    // Filling the input should enable the submit button.
    await input.fill('Apple Inc.');
    await expect(submit).toBeEnabled();
  });

  test('ResearchPanel closes via the close (X) button', async ({ page }) => {
    await page.waitForLoadState('networkidle');

    // Open the panel first.
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('open-research-panel', {
          detail: { companyName: 'Apple Inc.' },
        }),
      );
    });

    const panel = page.getByTestId('research-panel');
    await expect(panel).toBeVisible({ timeout: 5_000 });

    // Close button uses aria-label="关闭".
    const closeBtn = page.getByRole('button', { name: '关闭' });
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // AnimatePresence handles the exit animation; allow a short window.
    await expect(panel).not.toBeVisible({ timeout: 2_000 });
  });
});
