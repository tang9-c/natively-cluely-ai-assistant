import { enterOnboardingStep, onboardingScript, tabTo, captureOnboardingMatrix } from './onboarding-actions';
import { test, expect } from './fixtures';

test.describe('首次安装引导 IPC', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'missing-services' });
  test('[contract] fresh 初始化不会被后写入的旧欢迎标记替换', async ({ page }) => {
    const state = await page.evaluate(async () => {
      const first = await window.electronAPI.updateOnboardingProgress({ type: 'initialize', legacySeenStartup: false, legacyPermissionsShown: false });
      localStorage.setItem('natively_seen_startup_v1', 'true');
      await window.electronAPI.updateOnboardingProgress({ type: 'initialize', legacySeenStartup: true, legacyPermissionsShown: true });
      return first;
    });
    expect(state.success).toBe(true);
    if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.progress.origin).toBe('fresh');
  });
  test('[contract] 只读检查不验证服务，renderer 无法写完成时间', async ({ page, electronApp }) => {
    await page.evaluate(() => window.electronAPI.updateOnboardingProgress({ type: 'initialize', legacySeenStartup: false, legacyPermissionsShown: false }));
    const result = await page.evaluate(async () => {
      await window.electronAPI.getOnboardingState();
      return window.electronAPI.updateOnboardingProgress({ type: 'defer', configurationCompletedAt: 99 } as never);
    });
    expect(result.success).toBe(false);
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(0);
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.audioStarts)).toBe(0);
  });
  test('[contract] 直接 start-meeting 也遵循首次门禁，不产生会议事实', async ({ page }) => {
    await page.evaluate(() => window.electronAPI.updateOnboardingProgress({ type: 'initialize', legacySeenStartup: false, legacyPermissionsShown: false }));
    const result = await page.evaluate(() => window.electronAPI.startMeeting({ audio: {} }));
    expect(result.success).toBe(false);
    if (result.success) throw new Error('first run unexpectedly started');
    expect(result.recoveryStep).toBe('speech');
    const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
    if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.progress.firstMeetingEnteredAt).toBeUndefined();
    expect(await page.evaluate(() => window.electronAPI.getMeetingActive())).toBe(false);
  });
  test('[contract] 同 userData 真正重启保留进度与 origin', async ({ page, restartApp }) => {
    await page.evaluate(async () => {
      await window.electronAPI.updateOnboardingProgress({ type: 'initialize', legacySeenStartup: false, legacyPermissionsShown: false });
      await window.electronAPI.updateOnboardingProgress({ type: 'navigate', step: 'speech' });
    });
    const next = await restartApp();
    const state = await next.page.evaluate(async () => {
      await window.electronAPI.updateOnboardingProgress({ type: 'initialize', legacySeenStartup: true, legacyPermissionsShown: true });
      return window.electronAPI.getOnboardingState();
    });
    expect(state.success).toBe(true);
    if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.progress.origin).toBe('fresh'); expect(state.snapshot.progress.lastStep).toBe('speech');
  });
});

test.describe('首次安装引导界面', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'missing-services' });
  test('[navigation] 欢迎进入概览，稍后继续回到首页卡片', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=launcher'))!; win.setContentSize(1200, 800); });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await expect(page.getByRole('button', { name: '开始设置', exact: true })).toBeVisible();
    await page.screenshot({ path: '.tmp/onboarding-t09-welcome-light.png' });
    await page.getByRole('button', { name: '开始设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: /开始前/ })).toBeVisible();
    await expect(page.getByRole('button', { name: '开始设置', exact: true })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /先完成初始设置/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '正在读取…', exact: true })).toHaveCount(0);
    await page.screenshot({ path: '.tmp/onboarding-t09-overview-light.png' });
    await expect(page.getByText('此检查不会录音，也不会自动发送会议内容。')).toBeVisible();
    await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    await expect(page.getByRole('button', { name: '继续设置', exact: true })).toBeVisible();
    await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
  });
  test('[navigation] 重启恢复稍后状态，卡片收起不改持久进度，设置可重开', async ({ page, restartApp }) => {
    await page.getByRole('button', { name: '开始设置', exact: true }).click();
    await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    const next = await restartApp();
    await expect(next.page.getByRole('button', { name: '继续设置', exact: true })).toBeVisible();
    const before = await next.page.evaluate(() => window.electronAPI.getOnboardingState());
    await next.page.getByRole('button', { name: '收起设置提示' }).click();
    const after = await next.page.evaluate(() => window.electronAPI.getOnboardingState());
    if (!before.success || !after.success) throw new Error('snapshot required');
    expect(after.snapshot.progress).toEqual(before.snapshot.progress);
    await next.page.getByTestId('launcher-settings-button').click();
    await next.page.getByRole('button', { name: '初始设置', exact: true }).click();
    await expect(next.page.getByTestId('onboarding-flow')).toBeVisible();
  });
  test('[navigation] 600×400、暗色和减少动画下页脚与键盘可达', async ({ page, electronApp }) => {
    await electronApp.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=launcher'))!;
      win.setMinimumSize(400, 300); win.setContentSize(600, 400);
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
    const start = page.getByRole('button', { name: '开始设置', exact: true }); await start.focus(); await page.keyboard.press('Enter');
    const next = page.getByTestId('onboarding-primary'); await expect(next).toBeVisible();
    const box = await next.boundingBox(); const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.h); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w);
    await page.screenshot({ path: '.tmp/onboarding-t09-overview-600x400.png' });
    await next.focus(); await expect(next).toBeFocused(); await page.keyboard.press('Enter');
    await expect(page.getByRole('navigation', { name: '初始设置步骤' }).locator('button[aria-current="step"]')).toContainText('语音识别');
  });
});
test.describe('已有用户兼容', () => {
  test.use({ onboardingMode: 'existing', onboardingScenario: 'missing-services' });
  test('[navigation] 已有用户不强弹新引导，但可打开检查', async ({ page }) => {
    await expect(page.locator('#launcher-container')).toBeVisible();
    await expect(page.getByRole('button', { name: '开始设置', exact: true })).toHaveCount(0);
    await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
    await page.getByRole('button', { name: '继续设置', exact: true }).click();
    await expect(page.getByTestId('onboarding-flow')).toBeVisible();
  });
});
test.describe('未知进度版本', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'unknown-schema' });
  test('[navigation] 未知版本回首页展示诊断，保留原文件', async ({ page, electronApp }) => {
    await expect(page.locator('#launcher-container')).toBeVisible();
    await expect(page.getByRole('alert')).toContainText('版本');
    const version = await electronApp.evaluate(({ app }) => {
      const req = process.getBuiltinModule('node:module').createRequire(app.getAppPath() + '/fixture-check.cjs');
      return JSON.parse(req('node:fs').readFileSync(app.getPath('userData') + '/settings.json', 'utf8')).onboarding.version;
    });
    expect(version).toBe(999);
  });
});

test.describe('权限与语音配置', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'model-load-failed' });
  test('[permissions] 设备选择保存到原偏好，离开权限页停止电平', async ({ page, electronApp }) => {
    await page.getByRole('button', { name: '开始设置', exact: true }).click();
    await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /权限与设备/ }).click();
    await page.getByLabel('输入设备', { exact: true }).selectOption('fixture-input');
    await page.getByRole('button', { name: '保存设备', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('preferredInputDeviceId'))).toBe('fixture-input');
    await page.getByRole('button', { name: '检查电平', exact: true }).click();
    await expect(page.getByRole('button', { name: '停止检查', exact: true })).toBeVisible();
    await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /语音识别/ }).click();
    await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.audioStops)).toBeGreaterThan(0);
  });
  test('[speech] 文件存在但加载失败不允许继续，明确显示重试', async ({ page }) => {
    await page.getByRole('button', { name: '开始设置', exact: true }).click();
    await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /语音识别/ }).click();
    await page.getByRole('button', { name: '检查模型', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('模型加载失败');
    await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  });
});

test.describe('AI 配置', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'ready' });
  test('[ai] 未保存字段离开确认，开通说明返回不验证', async ({ page, electronApp }) => {
    await page.getByRole('button', { name: '开始设置', exact: true }).click();
    await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 服务/ }).click();
    await page.getByRole('button', { name: '我还没有账号或密钥', exact: true }).click();
    await electronApp.evaluate(({ shell }) => {
      (globalThis as any).__onboardingExternalTargets = [];
      shell.openExternal = async url => { (globalThis as any).__onboardingExternalTargets.push(url); };
    });
    await page.getByRole('button', { name: '打开官方入门', exact: true }).click();
    await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__onboardingExternalTargets)).toEqual(['https://docs.volcengine.com/docs/ark/quick-start-beginner?lang=zh']);
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('heading', { name: '开通豆包 AI 服务', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '我已准备好，返回填写', exact: true }).click();
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(0);
    await page.getByRole('button', { name: '更换密钥', exact: true }).click();
    await page.getByLabel('AI API Key', { exact: true }).fill('fixture-unsaved');
    await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /语音识别/ }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: '留在这里', exact: true }).click();
    await expect(page.getByLabel('AI API Key', { exact: true })).toHaveValue('fixture-unsaved');
    await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /语音识别/ }).click();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.getByRole('heading', { name: '设置语音识别', exact: true })).toBeVisible();
  });
});

test.describe('权限恢复', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'permission-denied' });
  test('[permissions] 拒绝授权可稍后继续，回焦后读取系统实际状态', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '权限与设备');
    await page.getByRole('button', { name: '允许访问麦克风', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('授权被拒绝');
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: '了解限制，继续设置', exact: true }).click();
    await onboardingScript(electronApp, 'restore-permissions');
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(page.getByRole('button', { name: '允许访问麦克风', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeEnabled();
  });
});
test.describe('设备回退', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'audio-fallback' });
  test('[permissions] 默认回退需确认，已存设备拔出后不能继续', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '权限与设备');
    await page.getByLabel('输入设备', { exact: true }).selectOption('fixture-input');
    await page.getByRole('button', { name: '保存设备', exact: true }).click();
    await page.getByRole('button', { name: '检查电平', exact: true }).click();
    await expect(page.getByText('当前检查的是系统默认设备。', { exact: false })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('preferredInputDeviceId'))).toBe('fixture-input');
    await page.getByRole('button', { name: '改用该设备', exact: true }).click();
    await expect(page.getByLabel('输入设备', { exact: true })).toHaveValue('default');
    await page.getByRole('button', { name: '保存设备', exact: true }).click();
    await onboardingScript(electronApp, 'unplug-input');
    await page.getByRole('button', { name: '刷新设备与权限', exact: true }).click();
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  });
});
test.describe('AI 保存错误', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'save-failed' });
  test('[ai] 保存失败不清空密钥、不验证，保存并离开失败也留页', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, 'AI 服务');
    await page.getByLabel('AI API Key', { exact: true }).fill('fixture-unsaved');
    await page.getByRole('button', { name: '保存并验证', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('未能保存');
    await expect(page.getByLabel('AI API Key', { exact: true })).toHaveValue('fixture-unsaved');
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(0);
    await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    await page.getByRole('button', { name: '保存并离开', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(page.getByLabel('AI API Key', { exact: true })).toHaveValue('fixture-unsaved');
  });
});
test.describe('AI 验证错误', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'ai-network-failed' });
  test('[ai] 密钥保存后清空，验证失败仍显示已保存', async ({ page }) => {
    await enterOnboardingStep(page, 'AI 服务');
    await page.getByRole('button', { name: '更换密钥', exact: true }).click();
    await page.getByLabel('AI API Key', { exact: true }).fill('fixture-saved');
    await page.getByRole('button', { name: '保存并验证', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('已保存，尚未验证所选模型');
    await expect(page.getByRole('alert')).toContainText('网络检查失败');
    await expect(page.getByLabel('AI API Key', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: '更换密钥', exact: true }).click();
    await expect(page.getByLabel('AI API Key', { exact: true })).toHaveValue('');
  });
});
test.describe('AI 范围拒绝', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'scope-denied' });
  test('[ai] 沿用全局拒绝策略，验证不发请求且不允许继续', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, 'AI 服务');
    await expect(page.getByLabel('全局：允许转写文本用于 AI')).toHaveValue('deny');
    await page.getByRole('button', { name: '保存并验证', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('全局策略不允许');
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(0);
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  });
});
test.describe('Codex 验证边界', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'codex-unsupported' });
  test('[ai] 程序检测和推理验证分开，不支持隔离时明确返回', async ({ page }) => {
    await enterOnboardingStep(page, 'AI 服务');
    await expect(page.getByText('尚未检测程序', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '验证当前配置', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('引导暂不能验证此配置');
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  });
});

test.describe('语音下载与云服务', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'missing-services' });
  test('[speech] 显式下载完成后加载验证，切到 AI 再返回仍看到通过', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '语音识别');
    await page.getByRole('button', { name: '下载模型', exact: true }).click();
    await expect(page.getByRole('button', { name: '先配置 AI', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: '先配置 AI', exact: true }).click();
    await onboardingScript(electronApp, 'download-complete');
    await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(1);
    await page.getByRole('navigation').getByRole('button', { name: /语音识别/ }).click();
    await expect(page.getByText('本次检查通过', { exact: false })).toBeVisible();
    await expect(page.getByRole('button', { name: '下载模型', exact: true })).toHaveCount(0);
  });
  test('[speech] 云 STT 单独保存密钥，凭据访问不会显示为真实识别成功', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '语音识别');
    await page.getByLabel('语音识别服务', { exact: true }).selectOption('doubao-auc');
    await page.getByLabel('语音 API Key', { exact: true }).fill('fixture-stt-key');
    await page.getByRole('button', { name: '保存并验证语音服务', exact: true }).click();
    const state = await page.evaluate(() => window.electronAPI.getOnboardingState()); if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.progress.validationReceipts.stt?.depth).toBe('credential_access');
    expect(state.snapshot.progress.validationReceipts.ai).toBeUndefined();
    expect(state.snapshot.progress.firstTranscriptReceivedAt).toBeUndefined();
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.audioStarts)).toBe(0);
    await page.getByRole('button', { name: '更换语音密钥', exact: true }).click();
    await expect(page.getByLabel('语音 API Key', { exact: true })).toHaveValue('');
  });
});
test.describe('语音不可用', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'language-unsupported' });
  test('[speech] 语言不兼容明确说明并阻止继续', async ({ page }) => {
    await enterOnboardingStep(page, '语音识别');
    await expect(page.getByRole('alert')).toContainText('不支持所选语言');
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  });
});
test.describe('下载错误', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'download-error' });
  test('[speech] 下载错误可重试，不把文件或任务存在当作通过', async ({ page }) => {
    await enterOnboardingStep(page, '语音识别');
    await page.getByRole('button', { name: '下载模型', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('网络检查失败');
    await expect(page.getByRole('button', { name: '重试', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
  });
});

test.describe('原设置与页面尺寸', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'ready' });
  test('[ai] 打开原设置先处理未保存字段，返回时重新读取配置', async ({ page }) => {
    await enterOnboardingStep(page, 'AI 服务');
    await page.getByRole('button', { name: '更换密钥', exact: true }).click();
    await page.getByLabel('AI API Key', { exact: true }).fill('fixture-discard');
    await page.getByRole('button', { name: '返回原设置', exact: true }).click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: '放弃修改', exact: true }).click();
    await expect(page.locator('#settings-panel')).toBeVisible();
    await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
    await page.getByRole('button', { name: /关闭/ }).first().click();
    await expect(page.getByRole('heading', { name: '连接 AI，让它帮助你理解会议' })).toBeVisible();
    await page.getByRole('button', { name: '更换密钥', exact: true }).click();
    await expect(page.getByLabel('AI API Key', { exact: true })).toHaveValue('');
  });
  test('[navigation] P2–P5 与开通页在四种尺寸主题组合下可滚动且页脚可达', async ({ page, electronApp }) => {
    await page.getByRole('button', { name: '开始设置', exact: true }).click();
    for (const [width, height, theme] of [[1200, 800, 'light'], [1200, 800, 'dark'], [600, 400, 'light'], [600, 400, 'dark']] as const) {
      await electronApp.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=launcher'))!; win.setMinimumSize(400, 300); win.setContentSize(size.width, size.height); }, { width, height });
      await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
      await page.emulateMedia({ reducedMotion: 'reduce' });
      for (const [step, label] of [['permissions', '权限与设备'], ['speech', '语音识别'], ['ai', 'AI 服务'], ['ready', '开始会议']] as const) {
        await page.getByRole('navigation').getByRole('button', { name: new RegExp(label) }).click();
        await expect(page.getByRole('navigation').locator('button[aria-current="step"]')).toContainText(label);
        const primary = page.getByTestId('onboarding-primary'); await expect(primary).toBeVisible();
        await expect(primary).not.toContainText('正在处理');
        const box = await primary.boundingBox(); const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.h); expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w);
        await page.screenshot({ path: `docs/qa/assets/2026-10-27-first-run-onboarding/${step}-${width}-${theme}.png` });
        if (step === 'ai') {
          await page.getByRole('button', { name: '我还没有账号或密钥', exact: true }).click();
          await expect(page.getByRole('heading', { name: '开通豆包 AI 服务', exact: true })).toBeFocused();
          const back = page.getByRole('button', { name: '我已准备好，返回填写', exact: true }); await back.scrollIntoViewIfNeeded();
          await page.screenshot({ path: `docs/qa/assets/2026-10-27-first-run-onboarding/provisioning-${width}-${theme}.png` });
          await back.focus(); await page.keyboard.press('Enter');
        }
      }
    }
  });
});

test.describe('保留历史 Whisper', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'whisper-current' });
  test('[speech] 沿用历史服务，明确保存后更换当前模型并加载验证', async ({ page }) => {
    await enterOnboardingStep(page, '语音识别');
    await expect(page.getByLabel('语音识别服务')).toHaveValue('local-whisper');
    await page.getByLabel('当前 Whisper 模型').selectOption('fixture-whisper-alternative');
    await page.getByRole('button', { name: '检查模型', exact: true }).click();
    await expect(page.getByText('本次检查通过', { exact: false })).toBeVisible();
    const state = await page.evaluate(() => window.electronAPI.getOnboardingState()); if (!state.success) throw new Error(state.errorCode);
    expect(state.snapshot.checks.stt.provider).toBe('local-whisper'); expect(state.snapshot.checks.stt.modelId).toBe('fixture-whisper-alternative');
  });
});


test.describe('T13 首次设置完整验收', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'ready' });
  test('[navigation] P0/P1/P6 四种尺寸主题和减少动画均可操作', async ({ page, electronApp }) => {
    const capture = async (name: string) => {
      for (const [width, height, theme] of [[1200, 800, 'light'], [1200, 800, 'dark'], [600, 400, 'light'], [600, 400, 'dark']] as const) {
        await electronApp.evaluate(({ BrowserWindow }, size) => { const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('window=launcher'))!; win.setMinimumSize(400, 300); win.setContentSize(size.width, size.height); }, { width, height });
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
        const primary = page.getByRole('button', { name: name === 'welcome' ? '开始设置' : '继续设置', exact: true });
        await expect(primary).toBeVisible();
        await primary.scrollIntoViewIfNeeded();
        const box = await primary.boundingBox(); expect(box!.y + box!.height).toBeLessThanOrEqual(height);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
        await page.screenshot({ path: `docs/qa/assets/2026-10-27-first-run-onboarding/${name}-${width}-${theme}.png` });
      }
    };
    await capture('welcome'); await page.getByRole('button', { name: '开始设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: /开始前/ })).toBeVisible(); await capture('overview');
    await page.getByRole('button', { name: '稍后继续', exact: true }).click(); await capture('resume');
  });
  test('[ai] 缺少模型或程序路径时聚焦对应字段，不调用验证', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, 'AI 服务'); await page.getByLabel('AI 模型', { exact: true }).fill('');
    await page.getByRole('button', { name: '保存并验证', exact: true }).click();
    await expect(page.getByLabel('AI 模型', { exact: true })).toBeFocused(); await expect(page.getByRole('alert')).toContainText('模型');
    await page.getByLabel('AI 服务', { exact: true }).selectOption('codex-cli');
    await page.getByLabel('Codex 程序路径', { exact: true }).fill('');
    await page.getByRole('button', { name: '验证当前配置', exact: true }).click();
    await expect(page.getByLabel('Codex 程序路径', { exact: true })).toBeFocused(); await expect(page.getByRole('alert')).toContainText('程序路径');
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(0);
  });
  test('[meeting] 仅用 Tab/Enter 完成设置导航、进入会议、关闭提示和结束会议', async ({ page, electronApp }) => {
    await tabTo(page, page.getByRole('button', { name: '开始设置', exact: true })); await page.keyboard.press('Enter');
    for (const label of ['权限与设备', '语音识别', 'AI 服务', '开始会议']) {
      const step = page.getByRole('navigation').getByRole('button', { name: new RegExp(label) });
      await tabTo(page, step); await page.keyboard.press('Enter');
      await expect(page.getByRole('navigation').locator('button[aria-current="step"]')).toContainText(label);
    }
    await tabTo(page, page.getByRole('button', { name: '开始会议', exact: true })); await page.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.electronAPI.getMeetingActive())).toBe(true);
    await expect.poll(() => electronApp.windows().find(p => p.url().includes('window=overlay'))?.url()).toBeTruthy();
    const live = electronApp.windows().find(p => p.url().includes('window=overlay'))!;
    await expect(live.getByTestId('first-meeting-hint')).toBeVisible();
    await tabTo(live, live.getByRole('button', { name: '知道了', exact: true })); await live.keyboard.press('Enter');
    await tabTo(live, live.getByRole('button', { name: '结束会议', exact: true })); await live.keyboard.press('Enter');
    await expect.poll(() => page.evaluate(() => window.electronAPI.getMeetingActive())).toBe(false);
  });
});
test.describe('T13 必填字段可访问性', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'missing-services' });
  test('[ai] 缺少密钥时聚焦错误字段，不保存、不调用验证', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, 'AI 服务');
    await page.getByRole('button', { name: '保存并验证', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('密钥');
    await expect(page.getByLabel('AI API Key', { exact: true })).toBeFocused();
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(0);
    await page.screenshot({ path: 'docs/qa/assets/2026-10-27-first-run-onboarding/ai-required-key.png' });
  });
  test('[speech] 云识别缺少密钥时聚焦输入框，不调用验证', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '语音识别'); await page.getByLabel('语音识别服务', { exact: true }).selectOption('doubao-auc');
    await page.getByRole('button', { name: '保存并验证语音服务', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('密钥');
    await expect(page.getByLabel('语音 API Key', { exact: true })).toBeFocused();
    expect(await electronApp.evaluate(() => (globalThis as any).__onboardingE2ECounters.validations)).toBe(0);
  });
});


test.describe('T13 下载视觉状态', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'download-running' });
  test('[speech] 下载中四种尺寸主题保留进度与并行设置入口', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '语音识别');
    await captureOnboardingMatrix(page, electronApp, 'download-running', async () => {
      const progress = page.getByRole('progressbar', { name: '模型下载进度' }); await progress.scrollIntoViewIfNeeded();
      await expect(progress).toHaveAttribute('value', '42');
      await expect(page.getByRole('button', { name: '先配置 AI', exact: true })).toBeEnabled();
    });
  });
});
test.describe('T13 未保存与存储错误视觉状态', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'save-failed' });
  test('[ai] 保存失败与未保存确认在四种尺寸主题可见且 Escape 保留输入', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, 'AI 服务');
    await page.getByLabel('AI API Key', { exact: true }).fill('fixture-not-a-real-key');
    await page.getByRole('button', { name: '保存并验证', exact: true }).click();
    await captureOnboardingMatrix(page, electronApp, 'save-failed', async () => {
      await page.getByRole('alert').scrollIntoViewIfNeeded(); await expect(page.getByRole('alert')).toContainText('未能保存');
    });
    await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    await captureOnboardingMatrix(page, electronApp, 'unsaved-dialog', async () => {
      const dialog = page.getByRole('alertdialog'); await expect(dialog).toBeVisible();
      const box = await dialog.locator(':scope > div').boundingBox(); const viewport = await page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.w); expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.h);
    });
    await page.keyboard.press('Escape'); await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByLabel('AI API Key', { exact: true })).toHaveValue('fixture-not-a-real-key');
  });
});
test.describe('T13 权限错误视觉状态', () => {
  test.use({ onboardingMode: 'fresh', onboardingScenario: 'permission-denied' });
  test('[permissions] 拒绝授权说明在四种尺寸主题可访问且不误放行', async ({ page, electronApp }) => {
    await enterOnboardingStep(page, '权限与设备');
    await page.getByRole('button', { name: '允许访问麦克风', exact: true }).click();
    await captureOnboardingMatrix(page, electronApp, 'permission-denied', async () => {
      const error = page.getByRole('alert'); await error.scrollIntoViewIfNeeded(); await expect(error).toContainText('授权被拒绝');
      await expect(page.getByRole('button', { name: '继续', exact: true })).toBeDisabled();
    });
  });
});
