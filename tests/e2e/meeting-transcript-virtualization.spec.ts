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
      INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms, segment_id)
      VALUES (?, ?, ?, ?, ?)
    `);
  const seed = db.transaction((count: number) => {
      const id = `virtual-${count}`;
      insertMeeting.run(
        id,
        `Virtual ${count}`,
        Date.now() - count,
        count * 1_000,
        JSON.stringify({ legacySummary: '', detailedSummary: { overview: '虚构会议摘要', actionItems: [], keyPoints: [] } }),
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
          `${id}-segment-${index}`,
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
  await expect(page.getByText('身份未确认', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('我', { exact: true })).toHaveCount(0);

  const selectedText = await page.locator('[data-transcript-row-key] p').first().evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString() ?? '';
  });
  expect(selectedText.length).toBeGreaterThan(0);

  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__virtualCopied = text; } } }));
  await page.getByRole('button', { name: '复制完整转录', exact: true }).click();
  const clipboardText = await page.evaluate(() => (window as any).__virtualCopied);
  expect(clipboardText).toContain('segment-5000-0');
  expect(clipboardText).toContain('segment-5000-4999');

  const currentHeading = page.getByLabel('会议标题', { exact: true });
  await page.locator('header button:not([disabled])').first().click();
  await expect(currentHeading).toBeHidden();
  const firstMeeting = page.getByText('Virtual 100', { exact: true });
  await expect(firstMeeting).toBeVisible();
  await firstMeeting.click();
  await expect(page.getByLabel('会议标题', { exact: true })).toBeVisible();
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
  await page.getByLabel('会议标题', { exact: true }).click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(menuHeading).toBeHidden();
});


test('T5 transcript drafts survive 5000-row virtualization, retry, reopen and safe outputs', async ({ electronApp, page }) => {
  await seedTranscriptMeetings(electronApp);
  await electronApp.evaluate(({ app }: any) => {
    const req = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(), 'fixture.cjs'));
    const db = new (req('better-sqlite3'))(process.getBuiltinModule('node:path').join(app.getPath('userData'), 'natively.db'));
    db.prepare('UPDATE transcripts SET speaker_identity_correction_json = ? WHERE segment_id = ?').run(JSON.stringify({ identity: 'other', source: 'user', correctedAt: 1 }), 'virtual-5000-segment-0');
    db.exec("CREATE TRIGGER t5_save_failure BEFORE UPDATE OF content ON transcripts BEGIN SELECT RAISE(ABORT,'fixture save failed'); END");db.close();
  });
  const list = await openTranscript(page, 5000);
  const row = page.locator('[data-transcript-row-key="segment:virtual-5000-segment-0"]');
  await row.locator('p').click();
  await row.getByRole('textbox', { name: '编辑转录' }).fill('虚构星舟纠正内容');
  await expect(page.getByText('保存失败，输入已保留。请重试后再离开或复制导出。')).toBeVisible();
  await page.screenshot({path: '.tmp/v28-t5/transcript-save-failed.png'});
  await list.evaluate(element => { element.scrollTop = element.scrollHeight; element.dispatchEvent(new Event('scroll')); });
  await expect(row).toHaveCount(0);
  await list.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await expect(row.locator('p')).toHaveText('虚构星舟纠正内容');
  await electronApp.evaluate(({ app }: any) => {
    const req = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(), 'fixture.cjs'));
    const db = new (req('better-sqlite3'))(process.getBuiltinModule('node:path').join(app.getPath('userData'), 'natively.db'));db.exec('DROP TRIGGER t5_save_failure');db.close();
  });
  await page.getByRole('button', { name: '重试保存', exact: true }).click();
  await expect(page.getByText('已保存', { exact: true })).toBeVisible();
  const saved = await page.evaluate(() => window.electronAPI.getMeetingDetails('virtual-5000'));
  expect(saved?.transcript?.[0]).toMatchObject({ segmentId: 'virtual-5000-segment-0', text: '虚构星舟纠正内容', timestamp: 0, speakerIdentityCorrection: { identity: 'other' } });
  expect(saved?.transcript?.[0].originalContent).toContain('segment-5000-0');
  expect(saved?.transcript?.[1].text).toBe('segment-5000-1');
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByText('Virtual 5000', { exact: true }).click();await page.getByRole('button', { name: '转录', exact: true }).click();
  await expect(row.locator('p')).toHaveText('虚构星舟纠正内容');
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { (window as any).__t5Copied = text; } } }));
  await page.getByRole('button', { name: '复制完整转录', exact: true }).click();
  expect(await page.evaluate(() => (window as any).__t5Copied)).toContain('虚构星舟纠正内容');
  const exportText = await electronApp.evaluate(async ({ app, dialog }: any) => {
    const req = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(), 'fixture.cjs'));
    const filename = process.getBuiltinModule('node:path').join(app.getPath('userData'), 't5-export.docx');
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename });
    return filename;
  });
  const exported = await page.evaluate(() => window.electronAPI.exportMeetingDocx('virtual-5000', true));
  expect(exported.success).toBe(true);
  const documentXml = await electronApp.evaluate(async (_: any, filename: string) => {
    const req = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(), 'fixture.cjs'));
    return (await req('jszip').loadAsync(process.getBuiltinModule('node:fs').readFileSync(filename))).file('word/document.xml').async('string');
  }, exportText);
  expect(documentXml).toContain('虚构星舟纠正内容');
});

test('T5 remembers only an explicitly selected pair and labels disabled SenseVoice rules', async ({electronApp,page}) => {
  await seedTranscriptMeetings(electronApp);await openTranscript(page,100);
  const initial=await page.evaluate(()=>window.electronAPI.localSenseVoiceGetTerms());
  await page.evaluate(async()=>{const current=await window.electronAPI.localSenseVoiceGetTerms();await window.electronAPI.localSenseVoiceSetTerms({...current,correctionEnabled:false});});
  const row=page.locator('[data-transcript-row-key="segment:virtual-100-segment-0"]');
  await row.locator('p').click();const input=row.getByRole('textbox',{name:'编辑转录'});await input.fill('虚构星州接口');
  await expect(page.getByText('已保存',{exact:true})).toBeVisible();
  expect((await page.evaluate(()=>window.electronAPI.localSenseVoiceGetTerms())).terms).toEqual(initial.terms);
  await input.focus();await input.evaluate((element:HTMLTextAreaElement)=>element.setSelectionRange(2,2));
  await page.keyboard.press('Shift+ArrowRight');await page.keyboard.press('Shift+ArrowRight');
  await row.getByRole('textbox',{name:'正确词'}).fill('星舟');
  await row.getByRole('button',{name:'替换所选词',exact:true}).click();
  await expect(row.getByRole('button',{name:'确认记住：星州 → 星舟（仅 SenseVoice）'})).toBeVisible();
  expect((await page.evaluate(()=>window.electronAPI.localSenseVoiceGetTerms())).terms).toEqual(initial.terms);
  await row.getByRole('button',{name:'确认记住：星州 → 星舟（仅 SenseVoice）'}).click();
  await expect(row.getByText('已保存但未启用，请在原词表管理页启用。')).toBeVisible();
  await expect(page.getByText('已保存',{exact:true})).toBeVisible();
  await page.screenshot({path: '.tmp/v28-t5/term-pair-disabled.png'});
  const after=await page.evaluate(()=>window.electronAPI.localSenseVoiceGetTerms());
  expect(after.terms.find(term=>term.canonical==='星舟')?.variants).toContain('星州');
  expect((await page.evaluate(()=>window.electronAPI.getMeetingDetails('virtual-100')))?.transcript?.[1].text).toBe('segment-100-1');
});


test('T5 blank transcript drafts remain editable and cannot silently delete a segment',async({electronApp,page})=>{
 await seedTranscriptMeetings(electronApp);await openTranscript(page,100);
 const row=page.locator('[data-transcript-row-key="segment:virtual-100-segment-0"]');await row.locator('p').click();
 await row.getByRole('textbox',{name:'编辑转录'}).fill('  ');await row.getByRole('button',{name:'完成编辑',exact:true}).click();
 await expect(row.getByRole('textbox',{name:'编辑转录'})).toBeVisible();
 await expect(row.getByRole('alert')).toHaveText('请保留有效转录内容，空白不会删除片段。');
 expect((await page.evaluate(()=>window.electronAPI.getMeetingDetails('virtual-100')))?.transcript?.[0].text).toContain('segment-100-0');
 await row.getByRole('textbox',{name:'编辑转录'}).fill('补充有效虚构转录');await expect(page.getByText('已保存',{exact:true})).toBeVisible();
});
