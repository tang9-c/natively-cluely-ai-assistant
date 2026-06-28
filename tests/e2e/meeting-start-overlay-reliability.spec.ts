import { test, expect } from './fixtures';

test.describe('meeting overlay startup reliability', () => {
  test.beforeEach(async ({ page }) => {
    await page.waitForLoadState('networkidle');
  });

  test('start button leaves the launcher after the first click so it cannot be clicked again', async ({ page }) => {
    const startButton = page.locator('button[aria-label="启动会议"]').first();
    await expect(startButton).toBeVisible();
    try {
      await startButton.click();
      await expect(startButton).toBeHidden({ timeout: 10_000 });
    } finally {
      await page.evaluate(() => (window as any).electronAPI?.endMeeting?.()).catch(() => {});
    }
  });
});
