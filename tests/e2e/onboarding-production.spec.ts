import { test, expect } from './fixtures';

test.use({ rendererMode: 'production', onboardingMode: 'fresh', onboardingScenario: 'none' });

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`DEVICE-01: cold production welcome exits with ${reducedMotion}`, async ({ page, electronApp }, testInfo) => {
    expect(page.url()).toMatch(/^file:.*\/dist\/index\.html\?window=launcher$/);
    expect(await electronApp.evaluate(() => process.env.NODE_ENV)).toBe('production');
    await page.emulateMedia({ reducedMotion });
    const lazyRequests: string[] = [];
    page.on('request', request => {
      if (/\/(Launcher|SettingsOverlay)-[^/]+\.js$/.test(request.url())) lazyRequests.push(request.url());
    });
    await page.getByRole('button', { name: '开始设置', exact: true }).click();
    await expect(page.getByRole('heading', { name: /开始前/ })).toBeVisible();
    // The exiting welcome's label changes to 正在读取…, so checking only the old
    // button name (or the mounted heading behind it) misses the production bug.
    await expect(page.getByRole('heading', { name: '先完成初始设置 再开始第一场会议' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '正在读取…', exact: true })).toHaveCount(0);
    const next = page.getByRole('button', { name: '继续设置', exact: true });
    await expect(next).toBeVisible();
    // Verify the actual pixels at the button centre belong to the control and
    // exercise a normal hit-tested click rather than a forced/DOM click.
    expect(await next.evaluate(button => {
      const box = button.getBoundingClientRect();
      return button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('overview.png') });
    await next.click();
    await expect(page.getByRole('navigation', { name: '初始设置步骤' }).locator('button[aria-current="step"]')).not.toContainText('设置概览');
    expect(lazyRequests.some(url => /\/Launcher-/.test(url))).toBe(true);
    await page.getByRole('navigation', { name: '初始设置步骤' }).getByRole('button', { name: '2 权限与设备' }).click();
    await expect(page.getByRole('heading', { name: '权限与设备', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '稍后继续', exact: true }).click();
    await expect(page.getByTestId('onboarding-flow')).toHaveCount(0);
    await expect(page.getByRole('button', { name: '继续设置', exact: true })).toBeVisible();
  });
}
