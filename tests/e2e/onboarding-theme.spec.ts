import { test, expect } from './fixtures';
import type { Locator, Page } from '@playwright/test';
import { enterOnboardingStep, onboardingScript } from './onboarding-actions';

type Theme = 'light' | 'dark';
async function appTheme(page: Page, theme: Theme, system: Theme) {
  await page.emulateMedia({ colorScheme: system, reducedMotion: 'reduce' });
  await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
}
async function tokenColor(locator: Locator, token: string, property = 'color') {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate((element, { token, property }) => {
    const value = getComputedStyle(element).getPropertyValue(token).trim();
    if (!value) return false;
    const probe = document.createElement('span'); probe.style.color = `var(${token})`;
    element.parentElement!.append(probe);
    const expected = getComputedStyle(probe).color; probe.remove();
    return getComputedStyle(element).getPropertyValue(property) === expected;
  }, { token, property })).toBe(true);
}
async function paletteContrast(page: Page) {
  const ratios = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const rgb = (token: string) => {
      const value = root.getPropertyValue(token).trim();
      if (!value) throw new Error(`Missing theme token ${token}`);
      const probe = document.createElement('span'); probe.style.color = value; document.body.append(probe);
      const color = getComputedStyle(probe).color; probe.remove();
      return color.match(/[\d.]+/g)!.slice(0, 3).map(Number);
    };
    const luminance = (color: number[]) => color.map(channel => {
      const value = channel / 255; return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    return ['info', 'success', 'warning', 'error'].flatMap(tone => {
      rgb(`--status-${tone}-border`);
      const text = luminance(rgb(`--status-${tone}-text`));
      return ['--bg-primary', '--bg-elevated', `--status-${tone}-bg`].map(surface => {
        const bg = luminance(rgb(surface));
        return { tone, surface, ratio: (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05) };
      });
    });
  });
  for (const result of ratios) expect(result.ratio, `${result.tone} on ${result.surface}`).toBeGreaterThanOrEqual(4.5);
}

for (const theme of ['light', 'dark'] as const) for (const system of ['light', 'dark'] as const) {
  test.describe(`onboarding colors app=${theme} system=${system}`, () => {
    test.use({ onboardingMode: 'fresh', onboardingScenario: 'permission-denied' });
    test('all setup pages use semantic colors across application and OS themes', async ({ page, electronApp }, testInfo) => {
      await appTheme(page, theme, system); await paletteContrast(page);
      await tokenColor(page.getByRole('heading', { name: '先完成初始设置 再开始第一场会议' }), '--text-primary');
      await tokenColor(page.getByRole('button', { name: '开始设置', exact: true }), '--btn-primary-bg', 'background-color');
      await tokenColor(page.getByRole('button', { name: '开始设置', exact: true }), '--btn-primary-text');
      await page.getByRole('button', { name: '开始设置', exact: true }).hover();
      await tokenColor(page.getByRole('button', { name: '开始设置', exact: true }), '--btn-primary-hover', 'background-color');
      await page.mouse.move(0, 0);
      await enterOnboardingStep(page, '设置概览');
      await tokenColor(page.getByText('功能受限', { exact: true }), '--status-warning-text');
      await tokenColor(page.getByText('需要处理', { exact: true }), '--status-error-text');
      const navigate = (name: string) => page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: new RegExp(name) }).click();
      await navigate('权限与设备');
      await tokenColor(page.getByTestId('onboarding-system-audio-permission'), '--status-warning-text');
      await expect(page.getByTestId('onboarding-primary')).toBeDisabled();
      await tokenColor(page.getByTestId('onboarding-primary'), '--btn-primary-disabled-text');
      await tokenColor(page.getByTestId('onboarding-primary'), '--btn-primary-disabled-bg', 'background-color');
      await page.getByRole('button', { name: '了解限制，继续设置', exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath('permissions.png') });
      await navigate('语音识别');
      await page.getByRole('button', { name: '检查模型', exact: true }).click();
      await tokenColor(page.getByText(/本次检查通过/), '--status-success-text');
      await navigate('AI 服务');
      await page.getByRole('button', { name: '我还没有账号或密钥', exact: true }).click();
      const back = page.getByRole('button', { name: '我已准备好，返回填写', exact: true });
      await tokenColor(back, '--btn-primary-bg', 'background-color'); await tokenColor(back, '--btn-primary-text');
      await tokenColor(page.getByRole('heading', { name: '开通豆包 AI 服务', exact: true }), '--text-primary');
      await back.click();
      await page.getByRole('button', { name: '更换密钥', exact: true }).click();
      await page.getByRole('button', { name: '保存并验证', exact: true }).click();
      await tokenColor(page.locator('#onboarding-ai-error'), '--status-error-text');
      await page.screenshot({ path: testInfo.outputPath('ai-error.png') });
      await page.getByLabel('AI API Key', { exact: true }).fill('fixture-theme-key');
      await navigate('设置概览');
      const dialog = page.getByRole('alertdialog');
      await tokenColor(dialog.getByRole('heading'), '--text-primary');
      await tokenColor(dialog.getByText('离开前保存这些修改？'), '--text-secondary');
      await dialog.getByRole('button', { name: '放弃修改', exact: true }).click();
      await tokenColor(page.getByText(/本次已确认/).last(), '--status-success-text');
      await navigate('AI 服务');
      await page.getByRole('button', { name: '保存并验证', exact: true }).click();
      await expect(page.locator('section > p[role="status"]')).toContainText('通过');
      await tokenColor(page.locator('section > p[role="status"]'), '--status-success-text');
      await navigate('开始会议');
      await tokenColor(page.getByText('你已了解系统音频限制；仍会按原流程尝试捕获并可能请求授权。'), '--status-warning-text');
      await tokenColor(page.getByTestId('onboarding-primary'), '--btn-primary-text');
      // Flip the application theme without changing OS preference: CSS must react immediately.
      const other = theme === 'light' ? 'dark' : 'light';
      await appTheme(page, other, system); await paletteContrast(page);
      await tokenColor(page.getByText('你已了解系统音频限制；仍会按原流程尝试捕获并可能请求授权。'), '--status-warning-text');
      await appTheme(page, theme, system);
      await electronApp.evaluate(({ BrowserWindow }, url) => {
        const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL() === url)!;
        win.setMinimumSize(400, 300); win.setContentSize(600, 400);
      }, page.url());
      await page.getByTestId('onboarding-primary').scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('ready-narrow.png') });
      await electronApp.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('update-onboarding-progress');
        ipcMain.handle('update-onboarding-progress', () => ({ success: false, errorCode: 'storage_failed', messageKey: 'onboarding.storage_failed' }));
      });
      await page.getByRole('button', { name: '稍后继续', exact: true }).click();
      const error = page.getByRole('alert');
      await tokenColor(error, '--status-error-text');
      await tokenColor(error, '--status-error-bg', 'background-color');
      await tokenColor(error, '--status-error-border', 'border-top-color');
      await error.scrollIntoViewIfNeeded();
      await page.screenshot({ path: testInfo.outputPath('flow-error.png') });
    });
  });
}

for (const theme of ['light', 'dark'] as const) test.describe(`first meeting colors ${theme}`, () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'ready' });
  test('first meeting progress, transcript and save failure have distinct theme colors', async ({ page, electronApp }, testInfo) => {
    await appTheme(page, theme, theme === 'light' ? 'dark' : 'light');
    await enterOnboardingStep(page, '开始会议');
    await tokenColor(page.getByText(/上次验证通过/).first(), '--status-info-text');
    const navigate = (name: string) => page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: new RegExp(name) }).click();
    await navigate('语音识别');
    await tokenColor(page.getByText(/上次检查通过，沿用历史回执/), '--status-info-text');
    await navigate('AI 服务');
    await tokenColor(page.locator('section > p[role="status"]'), '--status-info-text');
    await navigate('开始会议');
    await page.getByRole('button', { name: '开始会议', exact: true }).click();
    await expect.poll(() => electronApp.windows().find(page => page.url().includes('window=overlay'))?.url()).toBeTruthy();
    const live = electronApp.windows().find(page => page.url().includes('window=overlay'))!;
    await appTheme(live, theme, theme === 'light' ? 'dark' : 'light');
    const hint = live.getByTestId('first-meeting-hint');
    await tokenColor(hint.getByRole('status'), '--status-info-text');
    await onboardingScript(electronApp, 'transcript');
    await tokenColor(hint.getByRole('status'), '--status-success-text');
    await electronApp.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('update-onboarding-progress');
      ipcMain.handle('update-onboarding-progress', () => ({ success: false, errorCode: 'storage_failed', messageKey: 'onboarding.storage_failed' }));
    });
    await hint.getByRole('button', { name: '知道了', exact: true }).click();
    await tokenColor(hint.getByRole('alert'), '--status-error-text');
    await hint.screenshot({ path: testInfo.outputPath('meeting-hint.png') });
    await live.evaluate(() => window.electronAPI.endMeeting());
  });
});
