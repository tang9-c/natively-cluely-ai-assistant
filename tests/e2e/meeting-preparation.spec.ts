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

  test('keeps step two compact by replacing details with mode selection', async ({ page }) => {
    await advanceToConfirmation(page);

    await expect(page.getByTestId('meeting-preparation-page')).toContainText('描述会议');
    await expect(page.getByTestId('meeting-preparation-page')).toContainText('确认信息与模式');
    await expect(page.getByTestId('meeting-preparation-page')).toContainText('查看准备结果');
    await page.getByRole('button', { name: '确认并推荐模式' }).click();

    await expect(page.getByLabel('客户')).toBeHidden();
    await expect(page.getByText('已确认的会议信息')).toBeVisible();
    await expect(page.getByText(/推荐模式：(Sales|销售)/)).toBeVisible();

    await page.getByRole('button', { name: '返回修改信息' }).click();
    await expect(page.getByLabel('客户')).toHaveValue('启明机器人');
    await expect(page.getByText('已确认的会议信息')).toBeHidden();
  });

  test('offers, restores, and applies recruiting and team meeting modes', async ({ page }) => {
    await advanceToConfirmation(page);
    await page.getByRole('button', { name: '确认并推荐模式' }).click();

    await expect(page.getByRole('button', { name: '招聘', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '团队会议', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '团队会议', exact: true }).click();
    await page.getByRole('button', { name: '返回', exact: true }).click();
    await page.getByTestId('meeting-preparation-entry').click();
    await page.getByRole('button', { name: '最近准备' }).click();
    await page.getByRole('button', { name: /机器人行业案例与产品集成/ }).click();
    await expect(page.getByText('推荐模式：团队会议')).toBeVisible();

    await page.getByRole('button', { name: '生成准备结果' }).click();
    await page.getByRole('button', { name: '使用推荐模式开始会议' }).click();

    try {
      await expect.poll(() => page.evaluate(async () => {
        const mode = await (window as any).electronAPI.modesGetActive();
        return mode?.templateType;
      })).toBe('team-meet');
    } finally {
      await page.evaluate(() => (window as any).electronAPI?.endMeeting?.()).catch(() => {});
    }
  });

  test('starts a new preparation while keeping the previous draft in recent preparations', async ({ page }) => {
    await page.getByTestId('meeting-preparation-entry').click();
    await page.getByLabel('会议描述').fill('明天和新客户讨论机器人行业案例');
    await page.getByRole('button', { name: '返回' }).click();
    await expect(page.getByTestId('meeting-preparation-page')).toHaveCount(0);

    await page.getByTestId('meeting-preparation-entry').click();
    await expect(page.getByLabel('会议描述')).toHaveValue('');

    await page.getByRole('button', { name: '最近准备' }).click();
    await expect(page.getByText('明天和新客户讨论机器人行业案例')).toBeVisible();
  });

  test('recent preparations menu exposes its state and closes conventionally', async ({ page }) => {
    await page.getByTestId('meeting-preparation-entry').click();
    const trigger = page.getByRole('button', { name: '最近准备' });
    const createNew = page.getByRole('button', { name: '准备一场新会议' });

    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger.locator('svg')).toHaveClass(/rotate-180/);
    await expect(createNew).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(createNew).toBeHidden();

    await trigger.click();
    await page.getByRole('heading', { name: '会议作战准备卡' }).click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(createNew).toBeHidden();
  });

  test('company research remains navigation-only and preserves the draft', async ({ page }) => {
    await advanceToConfirmation(page);

    await page.getByRole('link', { name: '前往公司研究' }).click();
    await expect(page.getByTestId('research-panel')).toBeVisible();
    await page.getByTestId('research-panel').getByRole('button', { name: '关闭' }).click();

    await expect(page.getByTestId('research-panel')).toBeHidden();
    await expect(page.getByLabel('客户')).toHaveValue('启明机器人');
  });

  test('shows interim dictation in a readable textarea before recording stops', async ({ page }) => {
    await page.getByTestId('meeting-preparation-entry').click();
    const startButton = page.getByRole('button', { name: '开始语音输入' });
    await expect(startButton).toHaveClass(/bg-violet-600/);
    await startButton.click();
    await expect(page.getByText(/录音中/)).toBeVisible();
    const description = page.getByLabel('会议描述');
    await expect(description).toBeEnabled();
    await expect(description).toHaveAttribute('readonly', '');

    await page.evaluate(async () => {
      await (window as any).electronAPI.meetingPreparationDictationInject({
        text: '明天和启明机器人讨论行业案例',
        final: false,
        timestamp: Date.now(),
      });
    });

    await expect(description).toHaveValue('明天和启明机器人讨论行业案例');
    await page.getByRole('button', { name: '停止听写' }).click();
    await expect(description).not.toHaveAttribute('readonly', '');
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
