import { test, expect } from './fixtures';

async function seedTranscriptMeetings(electronApp: any) {
  await electronApp.evaluate(({ app }: any) => {
    const nodeModule = process.getBuiltinModule('node:module');
    const nodePath = process.getBuiltinModule('node:path');
    const appRequire = nodeModule.createRequire(nodePath.join(process.cwd(), 'electron-e2e.cjs'));
    const Database = appRequire('better-sqlite3');
    const db = new Database(nodePath.join(app.getPath('userData'), 'natively.db'));
  const insertMeeting = db.prepare(`
      INSERT OR REPLACE INTO meetings
        (id, title, start_time, duration_ms, summary_json, created_at, source, is_processed)
      VALUES (?, ?, ?, ?, ?, ?, 'e2e', 1)
    `);
  const deleteTranscripts = db.prepare('DELETE FROM transcripts WHERE meeting_id = ?');
  const insertTranscript = db.prepare(`
      INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
      VALUES (?, ?, ?, ?)
    `);
  const seed = db.transaction((count: number) => {
      const id = `virtual-${count}`;
      insertMeeting.run(
        id,
        `Virtual ${count}`,
        Date.now() - count,
        count * 1_000,
        JSON.stringify({ legacySummary: '', detailedSummary: { actionItems: [], keyPoints: [] } }),
        new Date().toISOString(),
      );
      deleteTranscripts.run(id);
      for (let index = 0; index < count; index += 1) {
        const suffix = index % 10 === 0
          ? ' 这是一条用于验证动态行高测量的长转录内容。'.repeat(8)
          : '';
        insertTranscript.run(
          id,
          index % 2 === 0 ? 'user' : 'interviewer',
          `segment-${count}-${index}${suffix}`,
          index * 1_000,
        );
      }
  });
    [100, 1_000, 5_000].forEach(seed);
    db.close();
  });
}

async function openTranscript(page: any, count: number) {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText(`Virtual ${count}`, { exact: true }).click();
  await page.getByRole('button', { name: '转录', exact: true }).click();
  const list = page.locator('[data-transcript-total-count]');
  await expect(list).toHaveAttribute('data-transcript-total-count', String(count));
  await expect.poll(async () => Number(
    await list.getAttribute('data-transcript-rendered-count'),
  )).toBeGreaterThan(0);
  return list;
}

test('large transcripts keep the DOM bounded and preserve full operations', async ({
  electronApp,
  page,
}) => {
  await seedTranscriptMeetings(electronApp);

  for (const count of [100, 1_000, 5_000]) {
    const list = await openTranscript(page, count);
    const rendered = Number(await list.getAttribute('data-transcript-rendered-count'));
    expect(rendered).toBeLessThan(40);
    expect(await page.locator('[data-transcript-row-key]').count()).toBeLessThan(40);
  }

  const list = page.locator('[data-transcript-total-count]');
  await list.evaluate((element) => {
    element.scrollTop = element.scrollHeight / 2;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.locator('[data-transcript-row-key]').count()).toBeGreaterThan(0);
  await expect(page.getByText('我', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('对方', { exact: true }).first()).toBeVisible();

  const selectedText = await page.locator('[data-transcript-row-key] p').first().evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });
  expect(selectedText.length).toBeGreaterThan(0);

  await page.getByRole('button', { name: '复制完整转录', exact: true }).click();
  const clipboardText = await electronApp.evaluate(({ clipboard }: any) => clipboard.readText());
  expect(clipboardText).toContain('segment-5000-0');
  expect(clipboardText).toContain('segment-5000-4999');

  const currentHeading = page.getByRole('heading', { name: 'Virtual 5000', exact: true });
  await page.locator('header button:not([disabled])').first().click();
  await expect(currentHeading).toBeHidden();
  const firstMeeting = page.getByText('Virtual 100', { exact: true });
  await expect(firstMeeting).toBeVisible();
  await firstMeeting.click();
  await expect(page.getByRole('heading', { name: 'Virtual 100', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '转录', exact: true }).click();
  const resetList = page.locator('[data-transcript-total-count="100"]');
  await expect(resetList).toBeVisible();
  expect(await resetList.evaluate(element => element.scrollTop)).toBeLessThan(2);
});

test('transcript skills menu exposes its state and closes conventionally', async ({
  electronApp,
  page,
}) => {
  await seedTranscriptMeetings(electronApp);
  await openTranscript(page, 100);

  const trigger = page.getByRole('button', { name: '用技能处理' });
  const menuHeading = page.getByText('选择技能', { exact: true });
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');

  await trigger.click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(trigger.locator('svg').last()).toHaveClass(/rotate-180/);
  await expect(menuHeading).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menuHeading).toBeHidden();

  await trigger.click();
  await page.getByRole('heading', { name: 'Virtual 100', exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menuHeading).toBeHidden();
});
