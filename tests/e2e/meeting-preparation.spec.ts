import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const meetingDescription = '和启明机器人研发总监进行产品技术交流，重点讨论行业案例和集成。';

async function advanceToConfirmation(page: Page): Promise<void> {
  await page.getByTestId('meeting-preparation-entry').click();
  await page.getByRole('textbox', { name: '会议描述' }).fill(meetingDescription);
  await page.getByRole('button', { name: '拆解会议信息' }).click();
  await expect(page.getByLabel('客户')).toHaveValue('启明机器人');
}

async function advanceToResults(page: Page): Promise<void> {
  await advanceToConfirmation(page);
  await page.getByRole('button', { name: '确认并推荐模式' }).click();
  await expect(page.getByText(/推荐模式：(Sales|销售)/)).toBeVisible();
  await page.getByRole('button', { name: '生成准备结果' }).click();
  await expect(page.getByTestId('meeting-preparation-page')).toContainText('准备完成');
}

test.describe('meeting preparation', () => {
  test('prepares a new Sales meeting without history or company research data', async ({ page }) => {
    await advanceToConfirmation(page);
    await page.getByRole('button', { name: '确认并推荐模式' }).click();
    await expect(page.getByText(/推荐模式：(Sales|销售)/)).toBeVisible();
    await expect(page.getByText('不关联，作为新会议')).toBeVisible();

    await page.getByRole('button', { name: '生成准备结果' }).click();
    await expect(page.getByTestId('meeting-preparation-page')).toContainText('准备完成');
    await expect(page.locator('[data-testid="preparation-question"]')).toHaveCount(3);
    await expect(page.getByText('资料缺失').first()).toBeVisible();
  });

  test('draft survives leaving and reopening the preparation page', async ({ page }) => {
    await page.getByTestId('meeting-preparation-entry').click();
    await page.getByLabel('会议描述').fill('明天和新客户讨论机器人行业案例');
    await page.getByRole('button', { name: '返回' }).click();

    await page.getByTestId('meeting-preparation-entry').click();
    await expect(page.getByLabel('会议描述')).toHaveValue('明天和新客户讨论机器人行业案例');
  });

  test('company research remains navigation-only and preserves the draft', async ({ page }) => {
    await advanceToConfirmation(page);

    await page.getByRole('link', { name: '前往公司研究' }).click();
    await expect(page.getByTestId('research-panel')).toBeVisible();
    await page.getByTestId('research-panel').getByRole('button', { name: '关闭' }).click();

    await expect(page.getByTestId('research-panel')).toBeHidden();
    await expect(page.getByLabel('客户')).toHaveValue('启明机器人');
  });

  test('accepts a controlled microphone-only dictation transcript', async ({ page }) => {
    await page.getByTestId('meeting-preparation-entry').click();
    await page.getByRole('button', { name: '开始语音输入' }).click();
    await expect(page.getByText(/录音中/)).toBeVisible();

    await page.evaluate(async () => {
      await (window as any).electronAPI.meetingPreparationDictationInject({
        text: '明天和启明机器人讨论行业案例',
        final: true,
        timestamp: Date.now(),
      });
    });
    await page.getByRole('button', { name: '停止听写' }).click();

    await expect(page.getByLabel('会议描述')).toHaveValue('明天和启明机器人讨论行业案例');
  });

  test('applies the confirmed mode and starts without a preparation payload', async ({ page }) => {
    await advanceToResults(page);
    const preparedStart = page.getByRole('button', { name: '使用推荐模式开始会议' });
    await expect(preparedStart).toBeVisible();
    try {
      await preparedStart.click();
      await expect.poll(() => page.evaluate(
        () => (window as any).electronAPI.getMeetingActive(),
      )).toBe(true);
      await expect.poll(() => page.evaluate(async () => {
        const mode = await (window as any).electronAPI.modesGetActive();
        return mode?.templateType;
      })).toBe('sales');
    } finally {
      await page.evaluate(() => (window as any).electronAPI?.endMeeting?.()).catch(() => {});
    }
  });
});
