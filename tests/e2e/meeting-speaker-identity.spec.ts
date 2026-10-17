import { test, expect } from './fixtures';

test('saved identity correction persists and selected batch remains virtualized', async ({ electronApp, page }) => {
  await electronApp.evaluate(({ app }: any) => {
    const module = process.getBuiltinModule('node:module');
    const path = process.getBuiltinModule('node:path');
    const require = module.createRequire(path.join(process.cwd(), 'speaker-e2e.cjs'));
    const Database = require('better-sqlite3');
    const db = new Database(path.join(app.getPath('userData'), 'natively.db'));
    db.prepare(`INSERT INTO meetings (id,title,start_time,duration_ms,summary_json,created_at,source,is_processed) VALUES (?,?,?,?,?,?,?,1)`)
      .run('identity-fixture','身份测试会议',Date.now(),1000,JSON.stringify({legacySummary:'已生成摘要',detailedSummary:{actionItems:[],keyPoints:[]}}),new Date().toISOString(),'e2e');
    const insert=db.prepare('INSERT INTO transcripts(meeting_id,speaker,content,timestamp_ms,segment_id) VALUES(?,?,?,?,?)');
    db.transaction(()=>{for(let i=0;i<5000;i++)insert.run('identity-fixture',i%2?'interviewer':'user',`虚构发言 ${i}`,i*1000,`identity-segment-${i}`);})();
    db.close();
  });
  await page.reload();
  await page.getByText('身份测试会议',{exact:true}).click();
  await page.getByRole('button',{name:'转录',exact:true}).click();
  const first=page.locator('[data-transcript-row-key]').first();
  await expect(first.getByRole('button',{name:'身份未确认',exact:true})).toBeVisible();
  await first.getByRole('button',{name:'身份未确认',exact:true}).click();
  await page.screenshot({path:'.tmp/v28-t2/saved-identity-menu.png'});
  await page.getByRole('menuitem',{name:'标记为我',exact:true}).click();
  await expect(first.getByRole('button',{name:'我',exact:true})).toBeVisible();
  await expect(page.getByText('身份已修改，已有摘要可能需要修正。')).toBeVisible();
  await page.reload();
  await page.getByText('身份测试会议',{exact:true}).click();
  await page.getByRole('button',{name:'转录',exact:true}).click();
  await expect(page.locator('[data-transcript-row-key]').first().getByRole('button',{name:'我',exact:true})).toBeVisible();
  await page.locator('[data-transcript-row-key]').first().getByRole('button',{name:'我',exact:true}).click();
  await page.getByRole('menuitem',{name:'选择多段',exact:true}).click();
  await page.getByRole('checkbox',{name:'选择发言片段'}).nth(1).check();
  await page.getByRole('button',{name:'批量修改身份',exact:true}).click();
  await electronApp.evaluate(({app}: any)=>{
    const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'failure-fixture.cjs'));
    const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
    db.exec("CREATE TRIGGER fail_identity BEFORE UPDATE OF speaker_identity_correction_json ON transcripts BEGIN SELECT RAISE(ABORT,'fixture_save_failure'); END;"); db.close();
  });
  await page.getByRole('menuitem',{name:'标记为其他参会者',exact:true}).click();
  await expect(page.getByText('身份保存失败，所选片段已保留，请重试。')).toBeVisible();
  await expect(page.getByRole('checkbox',{name:'选择发言片段'}).nth(0)).toBeChecked();
  await expect(page.getByRole('checkbox',{name:'选择发言片段'}).nth(1)).toBeChecked();
  await electronApp.evaluate(({app}: any)=>{
    const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'failure-fixture.cjs'));
    const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
    db.exec('DROP TRIGGER fail_identity'); db.close();
  });
  await page.getByRole('menuitem',{name:'标记为其他参会者',exact:true}).click();
  await expect(page.locator('[data-transcript-row-key]').first().getByRole('button',{name:'其他参会者',exact:true})).toBeVisible();
  expect(await page.locator('[data-transcript-row-key]').count()).toBeLessThan(40);
  await page.locator('[data-transcript-row-key]').first().getByRole('button',{name:'其他参会者',exact:true}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menuitem',{name:'恢复自动判断'})).toBeHidden();
  const retained=page.locator('[data-transcript-row-key]').first();
  await retained.getByRole('button',{name:'其他参会者',exact:true}).click();
  await page.getByRole('menuitem',{name:'标记为身份未确认',exact:true}).click();
  await expect(retained.getByRole('button',{name:'身份未确认',exact:true})).toHaveAttribute('title','人工标记为未确认');
  await retained.getByRole('button',{name:'身份未确认',exact:true}).click();
  await page.getByRole('menuitem',{name:'恢复自动判断',exact:true}).click();
  await expect(retained.getByRole('button',{name:'身份未确认',exact:true})).toHaveAttribute('title','音源不能确定人物身份');
});


test('live correction targets canonical merged scope and stale sessions fail safely', async ({electronApp,page})=>{
  await electronApp.evaluate(()=>{
    const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'offline-fixture.cjs'));
    const blocked=()=>{throw new Error('E2E external inference disabled');};
    require('node:http').request=blocked; require('node:https').request=blocked;
    require('node:child_process').spawn=blocked;
    globalThis.fetch=blocked as any;
    process.env.CUEUP_LONG_MEETING_BENCHMARK='1';
  });
  const started=await page.evaluate(()=>window.electronAPI.startMeeting());
  expect(started.success).toBe(true);
  await expect.poll(async()=>electronApp.windows().find(p=>p.url().includes('window=overlay'))?.url()).toBeTruthy();
  const live=electronApp.windows().find(p=>p.url().includes('window=overlay'))!;
  await live.waitForLoadState('domcontentloaded');
  await expect(live.getByRole('button',{name:'纠正发言身份',exact:true})).toBeHidden();
  const now=Date.now();
  await live.evaluate(async now=>{
    await window.electronAPI.benchmarkInjectTranscript({segmentId:'raw-a',speaker:'user',text:'我会提供',timestamp:now,final:true});
    await window.electronAPI.benchmarkInjectTranscript({segmentId:'raw-b',speaker:'user',text:'虚构的测试资料',timestamp:now+100,final:true});
  },now);
  await live.getByRole('button',{name:'纠正发言身份',exact:true}).click();
  await expect(live.getByText('我会提供虚构的测试资料',{exact:true})).toBeVisible();
  await live.getByRole('button',{name:'身份未确认',exact:true}).click();
  await expect(live.getByText('此段已合并，修改适用于整段',{exact:true})).toBeVisible();
  await live.screenshot({path:'.tmp/v28-t2/live-canonical-menu.png'});
  await live.getByRole('menuitem',{name:'标记为我',exact:true}).click();
  await expect(live.getByRole('button',{name:'我',exact:true})).toBeVisible();
  await live.getByRole('button',{name:'我',exact:true}).click();
  await live.getByRole('menuitem',{name:'标记为身份未确认',exact:true}).click();
  await expect(live.getByRole('button',{name:'身份未确认',exact:true})).toHaveAttribute('title','人工标记为未确认');
  const stale=await live.evaluate(()=>window.electronAPI.speakerVerificationSetSessionOverride({segmentId:'raw-a',sessionGeneration:'expired',action:'force_me'}));
  expect(stale.success).toBe(false);
});
