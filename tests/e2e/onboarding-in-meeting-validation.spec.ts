import { test, expect } from './fixtures';
import { onboardingScript } from './onboarding-actions';

test.use({ onboardingMode: 'fresh', onboardingScenario: 'ready' });

test('meeting checks saved cloud services without saving settings or restarting capture', async ({ page, electronApp }) => {
  expect((await page.evaluate(() => window.electronAPI.startMeeting())).success).toBe(true);
  const before = await electronApp.evaluate(async ({ app, ipcMain }) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/meeting-validation.cjs');
    const state = require(app.getAppPath() + '/dist-electron/electron/main.js').AppState.getInstance();
    const fixture = state.onboardingFixture;
    // Select synthetic, already-saved cloud configurations. The actual validator
    // still creates the receipts; no external service or real key is involved.
    fixture.saveConfiguration('stt', { provider: 'qcloud-stt', modelId: 'qcloud-stt' });
    fixture.saveConfiguration('ai', { provider: 'natively', modelId: 'natively' });
    const execute = fixture.execute;
    let rejectFirst = true;
    fixture.execute = async (...args) => {
      const evidence = await execute(...args);
      if (args[0] === 'stt' && rejectFirst) {
        rejectFirst = false;
        throw Object.assign(new Error('synthetic auth failure'), { code: 'authentication_failed' });
      }
      return evidence;
    };
    (globalThis as any).__meetingValidationWrites = 0;
    for (const channel of ['set-natively-api-key', 'set-default-model', 'set-stt-provider', 'set-recognition-language', 'set-provider-data-scopes']) {
      ipcMain.removeHandler(channel);
      ipcMain.handle(channel, () => { (globalThis as any).__meetingValidationWrites++; throw new Error('configuration write during meeting'); });
    }
    const snapshot = await state.onboardingService.refreshChecks();
    return { revision: snapshot.progress.configRevision, generation: snapshot.meeting.generation, audioStarts: fixture.counters.audioStarts, audioStops: fixture.counters.audioStops };
  });
  await page.evaluate(() => window.electronAPI.openOnboarding({ step: 'speech' }));
  const speech = page.getByRole('button', { name: '验证已保存的语音服务', exact: true });
  await expect(speech).toBeEnabled();
  await expect(page.getByRole('combobox', { name: '语音提供商', exact: true })).toBeDisabled();
  await expect(page.getByRole('combobox', { name: '会议语言', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '更换语音密钥', exact: true })).toBeDisabled();
  await speech.click();
  await expect(page.getByRole('alert')).toContainText('鉴权失败');
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByText(/本次检查通过/)).toBeVisible();
  await expect(page.getByRole('alert')).toBeHidden();
  await onboardingScript(electronApp, 'transcript');
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 提供商/ }).click();
  await expect(page.getByRole('combobox', { name: 'AI 提供商', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '验证已保存的 AI 服务', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('本次模型响应通过');
  const after = await electronApp.evaluate(async ({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/meeting-validation.cjs');
    const state = require(app.getAppPath() + '/dist-electron/electron/main.js').AppState.getInstance();
    const snapshot = state.onboardingService.getSnapshot();
    return { revision: snapshot.progress.configRevision, generation: snapshot.meeting.generation, active: state.getIsMeetingActive(), transcript: snapshot.meeting.hasTranscript,
      audioStarts: state.onboardingFixture.counters.audioStarts, audioStops: state.onboardingFixture.counters.audioStops,
      writes: (globalThis as any).__meetingValidationWrites, stt: snapshot.checks.stt.status, ai: snapshot.checks.ai.status };
  });
  expect(after).toEqual({ ...before, active: true, transcript: true, writes: 0, stt: 'verified', ai: 'verified' });
});

test('meeting still blocks local model and CLI checks in both UI and main process', async ({ page, electronApp }) => {
  expect((await page.evaluate(() => window.electronAPI.startMeeting())).success).toBe(true);
  await electronApp.evaluate(async ({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/meeting-validation.cjs');
    const state = require(app.getAppPath() + '/dist-electron/electron/main.js').AppState.getInstance();
    state.onboardingFixture.saveConfiguration('ai', { provider: 'codex-cli', modelId: 'codex-cli:gpt-5.4' });
    await state.onboardingService.refreshChecks();
  });
  await page.evaluate(() => window.electronAPI.openOnboarding({ step: 'speech' }));
  await expect(page.getByRole('button', { name: '检查模型', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '验证已保存的语音服务', exact: true })).toBeDisabled();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 提供商/ }).click();
  await expect(page.getByRole('button', { name: '验证已保存的 AI 服务', exact: true })).toBeDisabled();
  for (const target of ['stt', 'ai'] as const) {
    const result = await page.evaluate(async target => {
      const state = await window.electronAPI.getOnboardingState();
      if (!state.success) throw new Error('fixture state missing');
      return window.electronAPI.validateOnboardingService({ target, expectedRevision: state.snapshot.progress.configRevision[target] });
    }, target);
    expect(result).toMatchObject({ success: false, errorCode: 'busy' });
  }
});

for (const theme of ['light', 'dark'] as const) test(`permissions show current system capture evidence in ${theme} theme`, async ({ page, electronApp }) => {
  expect((await page.evaluate(() => window.electronAPI.startMeeting())).success).toBe(true);
  await electronApp.evaluate(({ app }) => {
    const require = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/runtime-audio-check.cjs');
    const state = require(app.getAppPath() + '/dist-electron/electron/main.js').AppState.getInstance();
    const { AudioCaptureHealthMonitor } = require(app.getAppPath() + '/dist-electron/electron/audio/AudioCaptureHealthMonitor.js');
    const { createOnboardingReadinessReader } = require(app.getAppPath() + '/dist-electron/electron/services/onboarding/OnboardingReadiness.js');
    const fixture = state.onboardingFixture;
    const health = new AudioCaptureHealthMonitor({ onState: captureState => state.broadcast('audio-capture-failed', {
      channel: 'system', source: 'capture', state: captureState, message: '', attempt: 0, maxAttempts: 3,
    }), onFailure() {} });
    state._captureHealth.system = health;
    // Synthetic capture boundary only: no native capture, permission request or network.
    state.systemAudioCapture = {};
    state.onboardingService.setCheckReader(createOnboardingReadinessReader({ isPackaged: () => true,
      readPermissions: async () => ({ ...fixture.permissions, screen: 'denied' }),
      inputDevices: () => fixture.devices, outputDevices: () => fixture.outputs,
      speechCheck: () => fixture.readConfiguration('stt'), systemAudioCheck: selection => state.getOnboardingSystemAudioCheck(selection) }));
    const token = health.bind(); health.start(token, false);
    (globalThis as any).__systemAudioEvidence = { health, token, state };
  });
  await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
  await page.evaluate(() => window.electronAPI.openOnboarding({ step: 'permissions' }));
  const audio = page.getByTestId('onboarding-system-audio-permission');
  await expect(audio).toContainText('系统音频尚未验证通过');
  await page.getByRole('button', { name: '刷新设备与权限', exact: true }).click();
  await expect(page.getByText('设备与权限已刷新', { exact: true })).toBeVisible();
  await expect(audio).toContainText('系统音频尚未验证通过');
  await electronApp.evaluate(() => {
    const { health, token } = (globalThis as any).__systemAudioEvidence;
    health.recordData(token, 4);
  });
  await expect(audio).toContainText('本次会议已成功采集系统音频');
  await expect(audio).toHaveClass(/text-status-success/);
  await electronApp.evaluate(() => {
    const { health, token } = (globalThis as any).__systemAudioEvidence;
    health.beginRecovery(token, true);
  });
  await expect(audio).toContainText('本次会议系统音频采集失败');
  await expect(audio).toHaveClass(/text-status-error/);
  await electronApp.evaluate(() => {
    const { health, token, state } = (globalThis as any).__systemAudioEvidence;
    state.isMeetingActive = false;
    state.onboardingService.recordMeetingEvent({ kind: 'ended', generation: state.onboardingService.getSnapshot().meeting.generation });
    health.resetSession(); health.recordData(token, 4);
  });
  await page.getByRole('button', { name: '刷新设备与权限', exact: true }).click();
  await expect(audio).toContainText('开始会议后将按实际采集结果确认');
  expect(await electronApp.evaluate(() => (globalThis as any).__systemAudioEvidence.health.isCapturing)).toBe(false);
});
