import { test, expect } from './fixtures';

test.use({ onboardingMode: 'fresh', onboardingScenario: 'none' });

test('legacy QCLOUD selection has the correct labels, saved key state and distinct provisioning portal', async ({ page, electronApp }, testInfo) => {
  const result = await page.evaluate(() => window.electronAPI.setNativelyApiKey('sk-' + 'QcloudFixtureOnly'.repeat(3), { selectAsDefault: true, deferValidation: true }));
  expect(result.success).toBe(true);
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await expect(page.getByTestId('onboarding-flow')).not.toContainText('natively');
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 提供商/ }).click();
  await expect(page.getByLabel('AI 提供商', { exact: true }).locator('option:checked')).toHaveText('QCLOUD API');
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('QCLOUD API');
  await expect(page.getByText('密钥已保存', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: '保存并验证', exact: true })).toBeVisible();
  await expect(page.getByText('引导暂不能验证此配置，原服务仍然保留。')).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('qcloud-saved.png') });
  await electronApp.evaluate(({ shell }) => {
    (globalThis as any).__qcloudExternalTargets = [];
    shell.openExternal = async url => { (globalThis as any).__qcloudExternalTargets.push(url); };
  });
  await page.getByRole('button', { name: '我还没有账号或密钥', exact: true }).click();
  await expect(page.getByRole('heading', { name: '开通 QCLOUD API', exact: true })).toBeVisible();
  await expect(page.getByText(/火山引擎/)).toHaveCount(0);
  await page.getByRole('button', { name: '打开 QCLOUD API 平台', exact: true }).click();
  await expect.poll(() => electronApp.evaluate(() => (globalThis as any).__qcloudExternalTargets)).toEqual(['https://aigw.feigenbaum.com.cn/']);
  await page.screenshot({ path: testInfo.outputPath('qcloud-provisioning.png') });
  await page.getByRole('button', { name: '我已准备好，返回填写', exact: true }).click();
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('QCLOUD API');
  const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
  expect(state.success && state.snapshot.progress.validationReceipts.ai).toBeUndefined();
});

test('fresh users can choose QCLOUD, save a QCLOUD key, and get an honest offline validation error', async ({ page }) => {
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 提供商/ }).click();
  await page.getByLabel('AI 提供商', { exact: true }).selectOption('natively');
  await expect(page.getByLabel('聊天默认模型', { exact: true })).toHaveValue('QCLOUD API');
  await page.getByRole('button', { name: '保存并验证', exact: true }).click();
  await expect(page.getByLabel('QCLOUD API Key', { exact: true })).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('请填写 QCLOUD API Key');
  await page.getByLabel('QCLOUD API Key', { exact: true }).fill('sk-' + 'QcloudFixtureOnly'.repeat(3));
  await page.getByRole('button', { name: '保存并验证', exact: true }).click();
  await expect(page.getByText('密钥已保存', { exact: false })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('网络检查失败');
  await expect(page.getByLabel('QCLOUD API Key', { exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => window.electronAPI.getDefaultModel())).model).toBe('natively');
  const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
  expect(state.success && state.snapshot.progress.validationReceipts.ai?.result).toBe('failed');
  expect(state.success && state.snapshot.progress.validationReceipts.ai?.provider).toBe('natively');
});

test('other service provisioning cannot silently fall through to Doubao', async ({ page }) => {
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 提供商/ }).click();
  await page.getByLabel('AI 提供商', { exact: true }).selectOption('codex-cli');
  await page.getByRole('button', { name: '我还没有账号或密钥', exact: true }).click();
  await expect(page.getByRole('heading', { name: '配置当前 AI 服务', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '开通豆包 AI 服务', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回原设置', exact: true })).toBeVisible();
});

for (const target of ['speech', 'ai'] as const) test(`QCLOUD shared key is reused after switching ${target} service, without re-entry or replacement`, async ({ page, restartApp }) => {
  await page.evaluate(async () => {
    await window.electronAPI.setNativelyApiKey('sk-' + 'SharedFixtureOnly'.repeat(3), { selectAsDefault: false, deferValidation: true });
    await window.electronAPI.setSttProvider('local-sensevoice');
    await window.electronAPI.setDefaultModel('doubao-seed-2-0-lite-260215');
    await window.electronAPI.setRecognitionLanguage('chinese');
  });
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  const nav = page.getByRole('navigation', { name: '初始设置步骤' });
  await nav.getByRole('button', { name: target === 'speech' ? /语音识别/ : /AI 提供商/ }).click();
  const service = page.getByLabel(target === 'speech' ? '语音提供商' : 'AI 提供商', { exact: true });
  await service.selectOption(target === 'speech' ? 'qcloud-stt' : 'natively');
  await expect(page.getByText(/密钥已保存/)).toBeVisible();
  if (target === 'ai') await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('QCLOUD API Key', { exact: true })).toHaveCount(0);
  // Changing key is deliberate; switching away and back must cancel that mode.
  await page.getByRole('button', { name: target === 'speech' ? '更换语音密钥' : '更换密钥', exact: true }).click();
  await page.getByRole('button', { name: target === 'speech' ? '保存并验证语音服务' : '保存并验证', exact: true }).click();
  await expect(page.getByLabel('QCLOUD API Key', { exact: true })).toBeFocused();
  await expect(page.getByText('请填写 QCLOUD API Key。', { exact: true })).toBeVisible();
  await service.selectOption(target === 'speech' ? 'local-sensevoice' : 'doubao');
  await service.selectOption(target === 'speech' ? 'qcloud-stt' : 'natively');
  await expect(page.getByText(/密钥已保存/)).toBeVisible();
  await page.getByRole('button', { name: target === 'speech' ? '保存并验证语音服务' : '保存并验证', exact: true }).click();
  await expect(page.getByText(/网络检查失败/)).toBeVisible();
  const after = await page.evaluate(() => window.electronAPI.getOnboardingState());
  expect(after.success && after.snapshot.checks[target === 'speech' ? 'stt' : 'ai'].provider).toBe(target === 'speech' ? 'qcloud-stt' : 'natively');
  expect(after.success && after.snapshot.checks.ai.qcloudKeyConfigured).toBe(true);
  const restarted = await restartApp();
  await restarted.page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: target === 'speech' ? /语音识别/ : /AI 提供商/ }).click();
  await expect(restarted.page.getByText(/密钥已保存/)).toBeVisible();
});

test('speech language error belongs to saved provider and language, and clears for a draft selection', async ({ page }) => {
  await page.evaluate(async () => {
    await window.electronAPI.setNativelyApiKey('sk-' + 'LanguageFixtureOnly'.repeat(3), { selectAsDefault: false, deferValidation: true });
    await window.electronAPI.setSttProvider('qcloud-stt');
    await window.electronAPI.setRecognitionLanguage('english-us');
  });
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /语音识别/ }).click();
  const unsupported = page.getByText('当前语音服务不支持所选语言，请更改语言或服务。', { exact: true });
  await expect(unsupported).toBeVisible();
  await page.getByLabel('会议语言', { exact: true }).selectOption('chinese');
  await expect(unsupported).toHaveCount(0);
  await expect(page.getByText('配置已更改，保存后重新检查。', { exact: true })).toBeVisible();
  await page.getByLabel('会议语言', { exact: true }).selectOption('english-us');
  await expect(unsupported).toBeVisible();
  await page.getByLabel('语音提供商', { exact: true }).selectOption('local-sensevoice');
  await expect(unsupported).toHaveCount(0);
  await page.getByLabel('语音提供商', { exact: true }).selectOption('qcloud-stt');
  await page.getByLabel('会议语言', { exact: true }).selectOption('chinese');
  await page.getByRole('button', { name: '保存并验证语音服务', exact: true }).click();
  await expect(page.getByText(/网络检查失败/)).toBeVisible();
  await expect(unsupported).toHaveCount(0);
  const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
  expect(state.success && state.snapshot.checks.stt.languageKey).toBe('chinese');
  expect(state.success && state.snapshot.checks.stt.messageKey).not.toBe('onboarding.language_unsupported');
});

test('QCLOUD without any shared key still requires explicit credential entry', async ({ page }) => {
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /语音识别/ }).click();
  await page.getByLabel('语音提供商', { exact: true }).selectOption('qcloud-stt');
  await page.getByRole('button', { name: '保存并验证语音服务', exact: true }).click();
  await expect(page.getByLabel('QCLOUD API Key', { exact: true })).toBeFocused();
  await expect(page.getByText('请填写 QCLOUD API Key。', { exact: true })).toBeVisible();
});
