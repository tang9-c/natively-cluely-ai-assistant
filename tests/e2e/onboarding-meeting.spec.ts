import { test, expect } from './fixtures';
import { enterOnboardingStep, onboardingScript, captureOnboardingMatrix } from './onboarding-actions';

test.describe('真实会议入口与首次提示', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'ready' });
  test('[meeting] P5 调用原入口，合成 connected 不构成转写，两种提示独立关闭', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '开始会议');
    await expect(page.getByText('会议内容保留：', { exact: false })).toContainText('永久');
    await page.getByRole('button', { name: '开始会议', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.electronAPI.getMeetingActive())).toBe(true);
    await expect.poll(() => electronApp.windows().find(p => p.url().includes('window=overlay'))?.url()).toBeTruthy();
    const live = electronApp.windows().find(p => p.url().includes('window=overlay'))!;
    await expect(live.getByTestId('first-meeting-hint')).toBeVisible();
    await onboardingScript(electronApp, 'audio-started');
    await expect(live.getByTestId('first-meeting-hint')).toContainText('音频已启动，等待转写');
    await live.screenshot({ path: '.tmp/onboarding-t12-first-meeting.png' });
    await captureOnboardingMatrix(live, electronApp, 'first-meeting', async () => {
      const hint = live.getByTestId('first-meeting-hint'); await expect(hint).toBeVisible();
      const box = await hint.boundingBox(), viewport = await live.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.h);
    });
    await electronApp.evaluate(({ BrowserWindow }) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('native-audio-connected'); });
    await expect(live.getByTestId('first-meeting-hint')).not.toContainText('已收到转写');
    await live.getByTestId('first-meeting-hint').getByRole('button', { name: '知道了' }).click();
    await expect(live.getByTestId('first-meeting-hint')).toHaveCount(0);
    await onboardingScript(electronApp, 'transcript');
    await expect(live.getByTestId('first-meeting-hint')).toContainText('点击回答或输入问题');
    await live.getByTestId('first-meeting-hint').getByRole('button', { name: '知道了' }).click();
    const state = await live.evaluate(() => window.electronAPI.getOnboardingState());
    if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.progress.meetingHintsDismissed).toEqual({ transcript: true, answer: true });
    expect(state.snapshot.progress.firstTranscriptReceivedAt).toBeUndefined();
    expect(state.snapshot.progress.firstMeetingEnteredAt).toBeUndefined();
    await live.evaluate(() => window.electronAPI.endMeeting());
  });
  test('[meeting] 并发与已有会议请求复用同一会议，配置页在 busy 时只读', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '开始会议');
    const before = await page.evaluate(() => window.electronAPI.getOnboardingState());
    if (!before.success) throw new Error(before.errorCode);
    const results = await page.evaluate(() => Promise.all([window.electronAPI.startMeeting(), window.electronAPI.startMeeting()]));
    expect(results.every(r => r.success)).toBe(true);
    const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
    if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.meeting.generation).toBe(before.snapshot.meeting.generation + 1);
    expect((await page.evaluate(() => window.electronAPI.startMeeting())).success).toBe(true);
    const repeated = await page.evaluate(() => window.electronAPI.getOnboardingState());
    if (!repeated.success) throw new Error(repeated.errorCode);
    expect(repeated.snapshot.meeting.generation).toBe(state.snapshot.meeting.generation);
    await page.evaluate(() => window.electronAPI.openOnboarding({ step: 'ai' }));
    await expect(page.getByLabel('聊天默认模型', { exact: true })).toBeDisabled();
    await onboardingScript(electronApp, 'invalidate-ai');
    await page.evaluate(() => window.electronAPI.openOnboarding({ step: 'ready' }));
    await expect(page.getByRole('button', { name: '返回当前会议', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '返回当前会议', exact: true }).click();
    await page.evaluate(() => window.electronAPI.endMeeting());
  });
  test('[meeting] 异步音频失败回首页显示修复卡，不遗留启动状态', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '开始会议');
    await page.getByRole('button', { name: '开始会议', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.electronAPI.getMeetingActive())).toBe(true);
    await onboardingScript(electronApp, 'fail-meeting');
    await expect(page.getByText('会议启动遇到问题', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '返回设置', exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.electronAPI.getMeetingActive())).toBe(false);
    await page.getByRole('button', { name: '返回设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: '权限与设备', exact: true })).toBeVisible();
    await page.evaluate(() => window.electronAPI.getOnboardingState());
    await page.evaluate(() => new Promise(requestAnimationFrame));
    await expect(page.getByRole('heading', { name: '权限与设备', exact: true })).toBeVisible();
    await page.evaluate(() => window.electronAPI.endMeeting());
  });
  test('[meeting] 同进度重启沿用历史回执，双窗口广播乱序不覆盖新状态', async ({ page, electronApp, restartApp }) => {
    await enterOnboardingStep(page, '开始会议');
    const next = await restartApp();
    const history = await next.page.evaluate(() => window.electronAPI.getOnboardingState());
    if (!history.success) throw new Error(history.errorCode);
    expect(history.snapshot.checks.ai.status).toBe('previously_verified');
    await next.page.getByRole('button', { name: '继续设置', exact: true }).click();
    await next.page.getByRole('button', { name: '开始会议', exact: true }).click();
    await expect.poll(() => next.electronApp.windows().find(p => p.url().includes('window=overlay'))?.url()).toBeTruthy();
    const live = next.electronApp.windows().find(p => p.url().includes('window=overlay'))!;
    await expect(live.getByTestId('first-meeting-hint')).toBeVisible();
    const old = await live.evaluate(() => window.electronAPI.getOnboardingState()); if (!old.success) throw new Error(old.errorCode);
    await live.getByRole('button', { name: '知道了', exact: true }).click();
    await next.electronApp.evaluate(({ BrowserWindow }, old) => { for (const win of BrowserWindow.getAllWindows()) win.webContents.send('onboarding-state-changed', old); }, old.snapshot);
    await expect(live.getByTestId('first-meeting-hint')).toHaveCount(0);
    await expect(next.page.getByRole('navigation', { name: '初始设置步骤' }).locator('button[aria-current="step"]')).toContainText('开始会议');
    await live.evaluate(() => window.electronAPI.endMeeting());
  });
});

test.describe('下载中跨页', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'download-running' });
  test('[speech] 下载中 P3→P4→P5 不误放行，返回 P3 进度仍在', async ({ page }) => {
    await enterOnboardingStep(page, '语音识别');
    await expect(page.getByRole('progressbar', { name: '模型下载进度' })).toHaveAttribute('value', '42');
    await page.getByRole('button', { name: '先配置 AI', exact: true }).click();
    await expect(page.getByRole('heading', { name: '连接 AI，让它帮助你理解会议' })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: /开始会议/ }).click();
    await expect(page.getByRole('button', { name: '开始会议', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续设置', exact: true })).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: /语音识别/ }).click();
    await expect(page.getByRole('progressbar', { name: '模型下载进度' })).toHaveAttribute('value', '42');
  });
});
test.describe('P5 保存失败', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'defer-save-failed' });
  test('[meeting] 稍后开始保存失败时留在摘要', async ({ page }) => {
    await enterOnboardingStep(page, '开始会议');
    await page.getByRole('button', { name: '稍后开始', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('未能读取或保存');
    await expect(page.getByRole('heading', { name: '设置检查', exact: true })).toBeVisible();
    const state = await page.evaluate(() => window.electronAPI.getOnboardingState()); if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.progress.deferredAt).toBeUndefined();
  });
});
