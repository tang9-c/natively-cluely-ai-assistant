import { test, expect } from './fixtures';

test.use({ onboardingMode: 'fresh', onboardingScenario: 'none' });

test('legacy QCLOUD selection has the correct labels, saved key state and distinct provisioning portal', async ({ page, electronApp }, testInfo) => {
  const result = await page.evaluate(() => window.electronAPI.setNativelyApiKey('sk-' + 'QcloudFixtureOnly'.repeat(3), { selectAsDefault: true, deferValidation: true }));
  expect(result.success).toBe(true);
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await expect(page.getByTestId('onboarding-flow')).not.toContainText('natively');
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 服务/ }).click();
  await expect(page.getByLabel('AI 服务', { exact: true }).locator('option:checked')).toHaveText('QCLOUD API');
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('QCLOUD API');
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
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('QCLOUD API');
  const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
  expect(state.success && state.snapshot.progress.validationReceipts.ai).toBeUndefined();
});

test('fresh users can choose QCLOUD, save a dedicated key, and get an honest offline validation error', async ({ page }) => {
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 服务/ }).click();
  await page.getByLabel('AI 服务', { exact: true }).selectOption('natively');
  await expect(page.getByLabel('AI 模型', { exact: true })).toHaveValue('QCLOUD API');
  await page.getByRole('button', { name: '保存并验证', exact: true }).click();
  await expect(page.getByLabel('AI API Key', { exact: true })).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('请填写 AI 密钥');
  await page.getByLabel('AI API Key', { exact: true }).fill('sk-' + 'QcloudFixtureOnly'.repeat(3));
  await page.getByRole('button', { name: '保存并验证', exact: true }).click();
  await expect(page.getByText('密钥已保存', { exact: false })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('网络检查失败');
  await expect(page.getByLabel('AI API Key', { exact: true })).toHaveCount(0);
  expect((await page.evaluate(() => window.electronAPI.getDefaultModel())).model).toBe('natively');
  const state = await page.evaluate(() => window.electronAPI.getOnboardingState());
  expect(state.success && state.snapshot.progress.validationReceipts.ai?.result).toBe('failed');
  expect(state.success && state.snapshot.progress.validationReceipts.ai?.provider).toBe('natively');
});

test('other service provisioning cannot silently fall through to Doubao', async ({ page }) => {
  await page.getByRole('button', { name: '开始设置', exact: true }).click();
  await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: /AI 服务/ }).click();
  await page.getByLabel('AI 服务', { exact: true }).selectOption('codex-cli');
  await page.getByRole('button', { name: '我还没有账号或密钥', exact: true }).click();
  await expect(page.getByRole('heading', { name: '配置当前 AI 服务', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '开通豆包 AI 服务', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回原设置', exact: true })).toBeVisible();
});
