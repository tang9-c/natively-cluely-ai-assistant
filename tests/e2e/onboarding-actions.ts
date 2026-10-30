import type { ElectronApplication, Page } from '@playwright/test';
export async function enterOnboardingStep(page: Page, label: string) {
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: new RegExp(label) }).click();
}
/** Fixed scripts in the isolated main test process; never adds a renderer state-writing IPC. */
export async function onboardingScript(electronApp: ElectronApplication, script: 'restore-permissions' | 'unplug-input' | 'download-complete' | 'transcript' | 'audio-started' | 'fail-meeting' | 'invalidate-ai') {
  await electronApp.evaluate(({ app }, script) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/onboarding-script.cjs');
    const state = require(app.getAppPath() + '/dist-electron/electron/main.js').AppState.getInstance();
    if (!state.onboardingFixture) throw new Error('fixture_not_enabled');
    const service = state.onboardingService;
    if (script === 'invalidate-ai') service.invalidate('ai');
    if (script === 'restore-permissions') { state.onboardingFixture.permissions.microphone = 'granted'; state.onboardingFixture.permissions.screen = 'granted'; state.onboardingFixture.captureState.permissionDenied = false; }
    if (script === 'unplug-input') state.onboardingFixture.devices.splice(0);
    if (script === 'download-complete') {
      const modelId = service.getSnapshot().checks.stt.modelId;
      state.onboardingFixture.completeDownload();
      service.updateDownload({ modelId, status: 'completed' });
      state.broadcast('local-sensevoice-download-complete', { modelId });
    }
    if (script === 'transcript' || script === 'audio-started') service.recordMeetingEvent({
      kind: script === 'transcript' ? 'transcript' : 'audio-started', generation: service.getSnapshot().meeting.generation, synthetic: true, hasNonEmptyText: true,
    });
    if (script === 'fail-meeting') state.handleMeetingAudioStartupFailure(new Error('fixture_audio_failed'), service.getSnapshot().meeting.generation, state.getIntelligenceManager().getSessionGeneration());
  }, script);
}

export async function tabTo(page: Page, target: import('@playwright/test').Locator) {
  for (let count = 0; count < 60; count++) {
    if (await target.evaluate(element => document.activeElement === element)) return;
    await page.keyboard.press('Tab');
  }
  throw new Error('Keyboard could not reach the intended control');
}

export async function captureOnboardingMatrix(page: Page, electronApp: ElectronApplication, name: string,
  verify: () => Promise<void> = async () => {}) {
  for (const [width, height, theme] of [[1200, 800, 'light'], [1200, 800, 'dark'], [600, 400, 'light'], [600, 400, 'dark']] as const) {
    await electronApp.evaluate(({ BrowserWindow }, size) => {
      const win = BrowserWindow.getAllWindows().find(window => window.webContents.getURL() === size.url);
      if (!win) throw new Error('Acceptance target window is missing');
      win.setMinimumSize(400, 300); win.setContentSize(size.width, size.height);
    }, { width, height, url: page.url() });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
    await verify();
    await page.screenshot({ path: `docs/qa/assets/2026-10-27-first-run-onboarding/${name}-${width}-${theme}.png` });
  }
}
