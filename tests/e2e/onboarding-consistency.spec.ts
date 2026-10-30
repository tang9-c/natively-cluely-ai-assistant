import { test, expect } from './fixtures';
test.use({ onboardingMode: 'fresh', onboardingScenario: 'none' });
const nav = (page: import('@playwright/test').Page, name: RegExp) => page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name });

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
  await expect(settings.getByText('QCLOUD API', { exact: true }).last()).toBeVisible();
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
