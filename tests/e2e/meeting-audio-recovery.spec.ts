import { test, expect } from './fixtures';

test('audio recovery stays quiet, failures remain channel-specific and permission repair stays user-driven', async ({ electronApp, page }) => {
  await electronApp.evaluate(() => {
    const require = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(), 'audio-offline-fixture.cjs'));
    const blocked = () => { throw new Error('E2E external inference disabled'); };
    require('node:http').request = blocked;
    require('node:https').request = blocked;
    require('node:child_process').spawn = blocked;
    globalThis.fetch = blocked as any;
  });
  const result = await page.evaluate(() => window.electronAPI.startMeeting());
  expect(result.success).toBe(true);
  await expect.poll(() => electronApp.windows().find(p => p.url().includes('window=overlay'))?.url()).toBeTruthy();
  const live = electronApp.windows().find(p => p.url().includes('window=overlay'))!;
  await live.waitForLoadState('domcontentloaded');
  const send = async (payload: Record<string, unknown>) => {
    await electronApp.evaluate(({ BrowserWindow }, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().includes('window=overlay')) win.webContents.send('audio-capture-failed', payload);
      }
    }, { attempt: 1, maxAttempts: 3, message: '', ...payload });
  };
  for (let i = 0; i < 3; i++) await send({ channel: 'system', state: 'recovering' });
  await expect(live.getByText('音频采集异常', { exact: true })).toBeHidden();
  await live.screenshot({ path: '.tmp/v28-t3/ui-recovering.png' });

  const systemMessage = '系统音频采集未恢复，请打开设置检查输出设备或权限。';
  const micMessage = '麦克风采集未恢复，请打开设置检查输入设备或权限。';
  await send({ channel: 'system', state: 'failed', terminal: true, message: systemMessage, recommendedFix: 'open-settings' });
  await send({ channel: 'mic', state: 'healthy' });
  await expect(live.getByText(systemMessage, { exact: true })).toBeVisible();
  await expect(live.getByText('打开设置', { exact: true })).toBeVisible();
  await live.screenshot({ path: '.tmp/v28-t3/ui-system-failed-mic-healthy.png' });

  await send({ channel: 'mic', state: 'failed', terminal: true, message: micMessage, recommendedFix: 'open-settings' });
  await send({ channel: 'system', state: 'healthy' });
  await expect(live.getByText(micMessage, { exact: true })).toBeVisible();
  await live.screenshot({ path: '.tmp/v28-t3/ui-mic-failed-system-healthy.png' });
  await send({ channel: 'mic', state: 'healthy' });
  await expect(live.getByText(micMessage, { exact: true })).toBeHidden();

  await send({ channel: 'system', state: 'failed', terminal: true, message: '系统音频权限异常，请修复权限并重启应用。', recommendedFix: 'reset-tcc' });
  await expect(live.getByRole('button', { name: '修复权限并重启', exact: true })).toBeVisible();
  await live.screenshot({ path: '.tmp/v28-t3/ui-permission-action.png' });
  // Do not invoke real permission reset or application restart.
  await live.evaluate(() => window.electronAPI.endMeeting());
});
