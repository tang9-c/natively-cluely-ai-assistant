import { test, expect } from './fixtures';
test.use({ onboardingMode: 'fresh', onboardingScenario: 'none' });
const nav = (page: import('@playwright/test').Page, name: RegExp) => page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name });

test('explicit application activation restores a visible or hidden launcher and live theme updates', async ({ page, electronApp }) => {
  test.skip(process.platform !== 'darwin', 'application activate is a macOS lifecycle event');
  for (const hidden of [false, true]) {
    await electronApp.evaluate(({ BrowserWindow }, hidden) => {
      const launcher = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('window=launcher'))!;
      if (hidden) launcher.hide();
      else launcher.blur();
    }, hidden);
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()
      .find(win => win.webContents.getURL().includes('window=launcher'))!.isFocused())).toBe(false);
    await electronApp.evaluate(({ app }) => { app.emit('activate'); });
    await expect.poll(() => electronApp.evaluate(({ BrowserWindow }) => {
      const launcher = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes('window=launcher'))!;
      return { visible: launcher.isVisible(), focused: launcher.isFocused() };
    })).toEqual({ visible: true, focused: true });
  }
  for (const mode of ['dark', 'light'] as const) {
    await page.evaluate(mode => window.electronAPI.setThemeMode(mode), mode);
    await expect(page.locator('html')).toHaveAttribute('data-theme', mode);
    expect(await page.evaluate(() => window.electronAPI.getThemeMode())).toEqual({ mode, resolved: mode });
  }
});

for (const theme of ['light', 'dark'] as const) test(`in-app help explains current setup and permission boundaries in ${theme} theme`, async ({ page, electronApp }, testInfo) => {
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await nav(page, /AI 提供商/).click();
  await page.getByRole('button', { name: '返回原设置', exact: true }).click();
  const settings = page.locator('#settings-panel');
  await settings.getByRole('button', { name: '设置与帮助', exact: true }).click();
  await page.evaluate(theme => document.documentElement.setAttribute('data-theme', theme), theme);
  const help = settings.locator('[data-help-scroll-content]');
  await expect(help.getByRole('heading', { name: '初始设置：按五步完成', exact: true })).toBeVisible();
  await expect(help.getByText(/下方动画均为操作示意/)).toBeVisible();
  for (const title of ['设置概览', '权限与设备', '语音识别', 'AI 提供商', '开始会议']) {
    await expect(help.getByText(title, { exact: true })).toBeVisible();
  }
  await help.screenshot({ path: testInfo.outputPath(`help-setup-${theme}.png`) });
  await help.getByRole('button', { name: '1. 应用权限设置', exact: true }).click();
  if (await page.evaluate(() => window.electronAPI.platform === 'darwin')) {
    await expect(help.getByText(/屏幕录制开关不能单独证明系统音频可用或受限/)).toBeVisible();
    await expect(help.getByText(/未尝试实际采集时显示“使用时确认”/)).toBeVisible();
    await expect(help.getByText(/选择本地转写不等于后续 AI 回答一定在本地执行/)).toBeVisible();
  } else {
    await expect(help.getByText(/不要以是否出现一次性授权弹窗判断能否采音/)).toBeVisible();
  }
  await expect(help.getByText(/CueUp 完全在本地运行/)).toHaveCount(0);
  await help.getByRole('button', { name: '2. 音频语音转文字提供商设置（麦克风）', exact: true }).click();
  await expect(help.getByText(/语音识别与 AI 共用已保存的 QCLOUD API Key/)).toBeVisible();
  await expect(help.getByText(/豆包语音 Key 与豆包 AI Key 分别配置/)).toBeVisible();
  await expect(help.getByText('1. 本地 SenseVoice', { exact: true })).toBeVisible();
  await expect(help.getByText(/Embedding 保持本地优先；本地向量模型不可用时/)).toBeVisible();
  await expect(help.getByText(/规范词 \+ 变体/)).toBeVisible();
  await expect(help.getByText(/分别为麦克风通道和系统音频通道选择模型/)).toBeVisible();
  await expect(help.getByText(/语言或模型不兼容时按提示更换/)).toBeVisible();
  await help.getByRole('button', { name: '3. AI 模型与提示词引擎', exact: true }).click();
  await expect(help.getByText(/数据范围是一套全局策略/)).toBeVisible();
  await expect(help.getByText(/不控制云端语音识别的原始音频上传/)).toBeVisible();
  await expect(help.getByText('Codex CLI 与历史配置', { exact: true })).toBeVisible();
  await expect(help.getByText(/检测 CLI.*只确认程序可执行/)).toBeVisible();
  await electronApp.evaluate(({ shell }) => {
    (globalThis as any).__helpExternalTargets = [];
    shell.openExternal = async url => { (globalThis as any).__helpExternalTargets.push(url); };
  });
  await help.getByRole('button', { name: '打开 QCLOUD API 平台', exact: true }).click();
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__helpExternalTargets)).toEqual(['https://aigw.feigenbaum.com.cn/']);
  await help.getByRole('button', { name: '11. 窗口与通用设置', exact: true }).click();
  await expect(help.getByText(/credentials.enc.*明文 JSON/)).toBeVisible();
  await expect(help.getByText(/macOS.*DMG.*手动安装/)).toBeVisible();
  await settings.getByRole('button', { name: 'QCLOUD API', exact: true }).click();
  await expect(settings.getByText(/Embedding 保持本地优先；本地向量模型不可用时/)).toBeVisible();
  await expect(settings.getByText(/可在“音频”标签选择 QCLOUD API/)).toBeVisible();
});

for (const selector of ['codex-cli', 'codex-cli:gpt-5.4']) test(`existing Codex ${selector} remains editable and preserves its selector across save and restart`, async ({ page, restartApp }) => {
  await page.evaluate(async selector => {
    await window.electronAPI.setCodexCliConfig({ enabled: true, path: 'codex', model: 'gpt-5.4', timeoutMs: 60000 });
    await window.electronAPI.setDefaultModel(selector);
  }, selector);
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await nav(page, /AI 提供商/).click();
  await expect(page.getByLabel('AI 提供商', { exact: true })).toHaveValue('codex-cli');
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('ChatGPT 5.4');
  await expect(page.getByRole('button', { name: '验证当前配置', exact: true })).toBeVisible();
  await expect(page.getByText('引导暂不能验证此配置，原服务仍然保留。')).toHaveCount(0);
  await page.getByLabel('可执行文件', { exact: true }).fill('codex-fixture');
  await nav(page, /语音识别/).click();
  await page.getByRole('button', { name: '保存并离开', exact: true }).click();
  expect((await page.evaluate(() => window.electronAPI.getDefaultModel())).model).toBe(selector);
  const config = await page.evaluate(() => window.electronAPI.getCodexCliConfig());
  expect(config.model).toBe('gpt-5.4'); expect(config.path).toBe('codex-fixture');
  const restarted = await restartApp();
  await nav(restarted.page, /AI 提供商/).click();
  await expect(restarted.page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('ChatGPT 5.4');
});

test('QCLOUD speech names, Chinese display and credential help agree with Settings', async ({ page }) => {
  await page.evaluate(async () => {
    await window.electronAPI.setNativelyApiKey('sk-' + 'ConsistencyFixture'.repeat(3), { selectAsDefault: false, deferValidation: true });
    await window.electronAPI.setSttProvider('qcloud-stt'); await window.electronAPI.setRecognitionLanguage('chinese');
  });
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /语音识别/).click();
  await expect(page.getByLabel('语音提供商', { exact: true }).locator('option:checked')).toHaveText('QCLOUD API');
  await expect(page.getByLabel('会议语言', { exact: true }).locator('option:checked')).toHaveText('中文（简体）');
  await page.getByRole('button', { name: '配置帮助', exact: true }).click();
  const settings = page.locator('#settings-panel');
  await expect(settings.getByRole('heading', { name: 'QCLOUD API', exact: true })).toBeVisible();
  await expect(settings.getByText('已连接', { exact: true })).toHaveCount(0);
  await settings.getByRole('button', { name: '音频', exact: true }).click();
  const qcloudChoices = settings.getByRole('button').filter({ hasText: '复用 QCLOUD API Key' });
  await expect(qcloudChoices).toHaveCount(1);
  await expect(qcloudChoices.first().getByText('QCLOUD API', { exact: true })).toBeVisible();
  await qcloudChoices.first().click();
  await expect(qcloudChoices).toHaveCount(2);
  await expect(qcloudChoices.last().getByText('QCLOUD API', { exact: true })).toBeVisible();
  await expect(settings.getByText(/^(qcloud-stt|QCloudSTT|natively)$/i)).toHaveCount(0);
  await qcloudChoices.last().click();
  expect(await page.evaluate(() => window.electronAPI.getSttProvider())).toBe('qcloud-stt');
  await expect(settings.getByText('中文', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '通用', exact: true }).click();
  await settings.getByRole('button', { name: '初始设置', exact: true }).click();
  await expect(page.getByLabel('语音提供商', { exact: true })).toHaveValue('qcloud-stt');
  expect(await page.evaluate(() => window.electronAPI.getSttLanguage())).toBe('chinese');
});

test('friendly model names and transcript policy round-trip through both entry points', async ({ page }) => {
  await page.evaluate(async () => { await window.electronAPI.setDoubaoLlmApiKey('fixture-only'); await window.electronAPI.setDefaultModel('doubao-seed-2-0-lite-260215'); });
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /AI 提供商/).click();
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('Doubao Seed 2.0 Lite');
  await page.getByRole('button', { name: '返回原设置', exact: true }).click();
  const settings = page.locator('#settings-panel');
  await expect(settings.getByRole('button', { name: '聊天默认模型', exact: true })).toContainText('Doubao Seed 2.0 Lite');
  await settings.getByRole('switch', { name: '允许 AI 使用转写内容', exact: true }).click();
  await settings.getByRole('button', { name: '通用', exact: true }).click();
  await settings.getByRole('button', { name: '初始设置', exact: true }).click();
  await expect(page.getByLabel('允许 AI 使用转写内容', { exact: true })).toHaveValue('deny');
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('Doubao Seed 2.0 Lite');
  expect((await page.evaluate(() => window.electronAPI.getDefaultModel())).model).toBe('doubao-seed-2-0-lite-260215');
  expect((await page.evaluate(() => window.electronAPI.getProviderDataScopes())).transcript).toBe(false);
});

for (const retention of ['7d', '30d'] as const) test(`legacy retention ${retention} is honestly displayed without silently changing it`, async ({ page }) => {
  await page.evaluate(retention => window.electronAPI.setMeetingRetention(retention), retention);
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /开始会议/).click();
  await expect(page.getByText(new RegExp(`${retention === '7d' ? '7' : '30'} 天（自动清理未启用）`))).toBeVisible();
  await page.getByRole('button', { name: '修改保留策略', exact: true }).click();
  await expect(page.locator('#settings-panel').getByText(/自动清理未启用/)).toBeVisible();
  expect(await page.evaluate(() => window.electronAPI.getMeetingRetention())).toBe(retention);
});

test('disconnected device preferences remain visible and an explicit default selection round-trips', async ({ page }) => {
  await page.evaluate(() => localStorage.setItem('preferredInputDeviceId', 'fixture-disconnected-mic'));
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /权限与设备/).click();
  await expect(page.getByLabel('输入设备', { exact: true }).locator('option:checked')).toHaveText('已保存设备（不可用）');
  await nav(page, /开始会议/).click(); await page.getByRole('button', { name: '修改保留策略', exact: true }).click();
  const settings = page.locator('#settings-panel'); await settings.getByRole('button', { name: '音频', exact: true }).click();
  const input = settings.getByText('输入设备', { exact: true }).locator('..').locator('..');
  await expect(input.getByRole('button', { name: '已保存设备（不可用）', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('preferredInputDeviceId'))).toBe('fixture-disconnected-mic');
  await input.getByRole('button', { name: '已保存设备（不可用）', exact: true }).click();
  await input.getByRole('button', { name: '系统默认', exact: true }).click();
  await settings.getByRole('button', { name: '通用', exact: true }).click();
  await settings.getByRole('button', { name: '初始设置', exact: true }).click(); await nav(page, /权限与设备/).click();
  await expect(page.getByLabel('输入设备', { exact: true })).toHaveValue('default');
  await expect(page.getByLabel('输出设备', { exact: true }).locator('option:checked')).toHaveText('系统默认');
});

test('a friendly Codex model choice persists its raw model ID without nesting selectors', async ({ page }) => {
  await page.evaluate(async () => {
    await window.electronAPI.setCodexCliConfig({ enabled: true, path: 'codex', model: 'gpt-5.4', timeoutMs: 60000 });
    await window.electronAPI.setDefaultModel('codex-cli:gpt-5.4');
  });
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /AI 提供商/).click();
  await page.getByLabel('聊天默认模型', { exact: true }).fill('ChatGPT 5.5');
  await nav(page, /语音识别/).click(); await page.getByRole('button', { name: '保存并离开', exact: true }).click();
  expect((await page.evaluate(() => window.electronAPI.getDefaultModel())).model).toBe('codex-cli:gpt-5.5');
  expect((await page.evaluate(() => window.electronAPI.getCodexCliConfig())).model).toBe('gpt-5.5');
});

test('custom Codex model IDs retain their spelling in both entry points', async ({ page }) => {
  await page.evaluate(async () => {
    await window.electronAPI.setCodexCliConfig({ enabled: true, path: 'codex', model: 'my-model.v2', timeoutMs: 60000 });
    await window.electronAPI.setDefaultModel('codex-cli:my-model.v2');
  });
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /AI 提供商/).click();
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('my-model.v2');
  await page.getByRole('button', { name: '返回原设置', exact: true }).click();
  await expect(page.locator('#settings-panel').getByRole('button', { name: '聊天默认模型', exact: true })).toContainText('my-model.v2');
  expect((await page.evaluate(() => window.electronAPI.getDefaultModel())).model).toBe('codex-cli:my-model.v2');
});

test('custom cloud preferred model IDs use the same spelling in both entry points', async ({ page }) => {
  await page.evaluate(async () => {
    await window.electronAPI.setDoubaoLlmApiKey('fixture-only');
    await window.electronAPI.setProviderPreferredModel('doubao', 'ep-Custom.123');
    await window.electronAPI.setDefaultModel('ep-Custom.123');
  });
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /AI 提供商/).click();
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('ep-Custom.123');
  await page.getByRole('button', { name: '返回原设置', exact: true }).click();
  await expect(page.locator('#settings-panel').getByRole('button', { name: '聊天默认模型', exact: true })).toContainText('ep-Custom.123');
});

test('custom provider display names survive a read-only round-trip without exposing its command', async ({ page }) => {
  const id = await page.evaluate(async () => {
    const saved = await window.electronAPI.saveCustomProvider({ id: 'fixture-custom', name: 'Example Custom', curlCommand: 'curl https://example.invalid/v1/chat/completions --data {{TEXT}}', responsePath: 'choices.0.message.content' });
    if (!saved.success) throw new Error('custom fixture save failed');
    await window.electronAPI.setDefaultModel('fixture-custom'); return 'fixture-custom';
  });
  await page.getByRole('button', { name: '开始设置', exact: true }).click(); await nav(page, /AI 提供商/).click();
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('Example Custom');
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveAttribute('readonly', '');
  await expect(page.getByTestId('onboarding-flow')).not.toContainText('example.invalid');
  await page.getByRole('button', { name: '返回原设置', exact: true }).click();
  await expect(page.locator('#settings-panel').getByRole('button', { name: '聊天默认模型', exact: true })).toContainText('Example Custom');
  expect((await page.evaluate(() => window.electronAPI.getDefaultModel())).model).toBe(id);
});
