import { test, expect } from './fixtures';
import { enterOnboardingStep, onboardingScript } from './onboarding-actions';

test.use({ onboardingMode: 'fresh', onboardingScenario: 'permission-denied' });

test('manual refresh clears obsolete system audio denial and shows authorized-but-not-captured status', async ({ page, electronApp }, testInfo) => {
  await enterOnboardingStep(page, '权限与设备');
  await expect(page.getByTestId('onboarding-system-audio-permission')).toContainText('应用当前读取的屏幕录制权限未开启');
  await page.screenshot({ path: testInfo.outputPath('permissions-app-denied.png') });
  await page.getByRole('button', { name: '了解限制，继续设置', exact: true }).click();
  await onboardingScript(electronApp, 'restore-permissions');
  await page.getByRole('button', { name: '刷新设备与权限', exact: true }).click();
  await expect(page.getByTestId('onboarding-system-audio-permission')).toContainText('系统授权已开启');
  await expect(page.getByRole('button', { name: '已了解系统音频限制', exact: true })).toHaveCount(0);
  await expect(page.getByText(/设备与权限已刷新/)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('permissions-restored.png') });
  const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
  expect(state.success && state.snapshot.progress.acceptedSystemAudioLimitation).toBe(false);
});

test('refresh gives progress, reports failure and clears the old read error on successful retry', async ({ page, electronApp }) => {
  await enterOnboardingStep(page, '权限与设备');
  await expect(page.getByText(/设备与权限已刷新/)).toBeVisible();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('permissions:check');
    ipcMain.handle('permissions:check', () => new Promise((_resolve, reject) => { (globalThis as any).__rejectPermissionRead = () => reject(new Error('isolated permission read failure')); }));
  });
  await page.getByRole('button', { name: '刷新设备与权限', exact: true }).click();
  await expect(page.getByRole('button', { name: '正在刷新…', exact: true })).toBeDisabled();
  await electronApp.evaluate(() => (globalThis as any).__rejectPermissionRead());
  await expect(page.getByRole('alert')).toContainText('无法读取设备或权限');
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('permissions:check');
    ipcMain.handle('permissions:check', () => ({ platform: 'darwin', microphone: 'denied', screen: 'denied' }));
  });
  await page.getByRole('button', { name: '刷新设备与权限', exact: true }).click();
  await expect(page.getByText(/设备与权限已刷新/)).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a structured readiness failure is not reported as a successful refresh', async ({ page, electronApp }) => {
  await enterOnboardingStep(page, '权限与设备');
  await expect(page.getByText('设备与权限已刷新', { exact: true })).toBeVisible();
  await electronApp.evaluate(({ ipcMain }) => {
    ipcMain.removeHandler('get-onboarding-state');
    ipcMain.handle('get-onboarding-state', () => ({ success: false, errorCode: 'storage_failed', messageKey: 'onboarding.storage_failed' }));
  });
  await page.getByRole('button', { name: '刷新设备与权限', exact: true }).click();
  await expect(page.getByText('无法读取设备或权限，请刷新重试。', { exact: true })).toBeVisible();
  await expect(page.getByText('设备与权限已刷新', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '刷新设备与权限', exact: true })).toBeEnabled();
});
