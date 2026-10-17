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
    await live.evaluate(() => {
      (window as any).__audioStateDelivered = new Promise<void>((resolve) => {
        const unsubscribe = window.electronAPI.onAudioCaptureFailed(() => {
          unsubscribe();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
    });
    await electronApp.evaluate(({ BrowserWindow }, payload) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().includes('window=overlay')) win.webContents.send('audio-capture-failed', payload);
      }
    }, { attempt: 1, maxAttempts: 3, message: '', ...payload });
    await live.evaluate(() => (window as any).__audioStateDelivered);
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

  const connected = async (channel: 'system' | 'mic') => {
    await live.evaluate(() => {
      (window as any).__sttStateDelivered = new Promise<void>((resolve) => {
        const unsubscribe = window.electronAPI.onSttStatusChanged(() => {
          unsubscribe();
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
      });
    });
    await electronApp.evaluate(({ BrowserWindow }, channel) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (win.webContents.getURL().includes('window=overlay')) win.webContents.send('stt-status', { channel: channel === 'system' ? 'interviewer' : 'user', provider: 'fictional-local', state: 'connected' });
      }
    }, channel);
    await live.evaluate(() => (window as any).__sttStateDelivered);
  };
  for (const channel of ['system', 'mic'] as const) {
    const recognitionMessage = channel === 'system'
      ? '系统音频识别未启动，请打开设置检查识别服务。'
      : '麦克风识别未启动，请打开设置检查识别服务。';
    const captureMessage = channel === 'system' ? systemMessage : micMessage;
    await send({ channel, source: 'stt', terminal: true, message: recognitionMessage, recommendedFix: 'open-settings' });
    await send({ channel, source: 'capture', state: 'failed', terminal: true, message: captureMessage, recommendedFix: 'open-settings' });
    await send({ channel, source: 'capture', state: 'healthy' });
    await expect(live.getByText(recognitionMessage, { exact: true })).toBeVisible();
    await expect(live.getByText('语音识别异常', { exact: true })).toBeVisible();
    await live.screenshot({ path: `.tmp/v28-t3/fix-round-1/ui-${channel}-stt-failed-capture-healthy.png` });
    await connected(channel);
    await expect(live.getByText(recognitionMessage, { exact: true })).toBeHidden();
    await send({ channel, source: 'capture', state: 'failed', terminal: true, message: captureMessage, recommendedFix: 'open-settings' });
    await connected(channel);
    await expect(live.getByText(captureMessage, { exact: true })).toBeVisible();
    await send({ channel, source: 'capture', state: 'healthy' });
    await expect(live.getByText(captureMessage, { exact: true })).toBeHidden();
  }

  await send({ channel: 'system', state: 'failed', terminal: true, message: '系统音频权限异常，请修复权限并重启应用。', recommendedFix: 'reset-tcc' });
  await expect(live.getByRole('button', { name: '修复权限并重启', exact: true })).toBeVisible();
  await live.screenshot({ path: '.tmp/v28-t3/ui-permission-action.png' });
  // Do not invoke real permission reset or application restart.
  await live.evaluate(() => window.electronAPI.endMeeting());
});
