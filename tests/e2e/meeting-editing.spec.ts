import { test, expect } from './fixtures';

async function seed(electronApp: any, transcriptCount = 1) {
 await electronApp.evaluate(({ app }: any, transcriptCount: number) => {
  const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'edit-e2e.cjs'));
  const blocked=()=>{throw new Error('E2E external boundary disabled');};
  require('node:http').request=blocked;require('node:https').request=blocked;globalThis.fetch=blocked;
  require('node:child_process').spawn=blocked;
  const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
  const summary={overview:'**原始摘要**',actionItems:['字符串任务'],keyPoints:['原始要点'],decisions:['原始结论'],openQuestions:['待确认问题'],sections:[{title:'会议结论',bullets:['分区结论']}],followUpDraft:'原有跟进草稿',actionItemsStructured:[{id:'owned',text:'结构任务',owner:'甲',deadline:'周五'}]};
  db.prepare('INSERT INTO meetings(id,title,start_time,duration_ms,summary_json,created_at,source,is_processed) VALUES(?,?,?,?,?,?,?,1)').run('editing-fixture','编辑测试会议',Date.now(),1000,JSON.stringify({legacySummary:'summary',detailedSummary:summary}),new Date().toISOString(),'e2e');
  const insert=db.prepare('INSERT INTO transcripts(meeting_id,speaker,content,timestamp_ms,segment_id) VALUES(?,?,?,?,?)');
  db.transaction(()=>{for(let i=0;i<transcriptCount;i++)insert.run('editing-fixture','user',i===0?'原始转录':`虚构转录 ${i}`,i+1,`seg-${i}`);})();db.close();
 },transcriptCount);
}
async function open(page: any) {await page.reload();await page.getByText('编辑测试会议',{exact:true}).click();await expect(page.getByLabel('摘要正文',{exact:true})).toBeVisible();}
async function edit(page: any, label: string, text: string) {
 const block=page.getByLabel(label,{exact:true});await block.click();await block.fill(text);
}

test('one canonical action list; body, owner and deadline persist and delete-all stays empty',async({electronApp,page})=>{
 await seed(electronApp);await open(page);
 await expect(page.getByRole('heading',{name:'下一步',exact:true})).toHaveCount(0);
 await edit(page,'摘要正文','**修正摘要**');
 await edit(page,'要点 1','修正要点');await edit(page,'决策 1','修正决策');
 await edit(page,'待确认事项 1','修正问题');await edit(page,'分区 1 结论 1','修正分区结论');
 await edit(page,'行动项 1 负责人','乙');await edit(page,'行动项 1 期限','下周');
 await page.getByRole('button',{name:'转录',exact:true}).click();
 await expect(page.getByText('原始转录',{exact:true})).toBeVisible();
 await page.reload();await page.getByText('编辑测试会议',{exact:true}).click();
 await expect(page.getByLabel('摘要正文',{exact:true})).toBeVisible();
 await expect(page.getByLabel('摘要正文',{exact:true})).toContainText('修正摘要');
 await expect(page.getByLabel('要点 1',{exact:true})).toHaveText('修正要点');
 await expect(page.getByLabel('决策 1',{exact:true})).toHaveText('修正决策');
 await expect(page.getByLabel('待确认事项 1',{exact:true})).toHaveText('修正问题');
 await expect(page.getByLabel('分区 1 结论 1',{exact:true})).toHaveText('修正分区结论');
 await expect(page.getByLabel('行动项 1 负责人',{exact:true})).toHaveText('乙');
 await expect(page.getByLabel('行动项 1 期限',{exact:true})).toHaveText('下周');
 await page.getByRole('button',{name:'删除行动项 1',exact:true}).click();
 await page.getByRole('button',{name:'删除行动项 1',exact:true}).click();
 await page.getByRole('button',{name:'转录',exact:true}).click();
 await page.reload();await page.getByText('编辑测试会议',{exact:true}).click();
 await expect(page.getByLabel('摘要正文',{exact:true})).toBeVisible();
 await expect(page.getByLabel('行动项 1 内容',{exact:true})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'添加行动项',exact:true})).toBeVisible();
 await expect.poll(async()=>(await page.getByLabel('会议标题',{exact:true}).boundingBox())?.y ?? 9999).toBeLessThan(200);
 await page.screenshot({path:'.tmp/v28-t4/canonical-empty.png',animations:'disabled'});
 await page.getByRole('button',{name:'添加行动项',exact:true}).click();await edit(page,'行动项 1 内容','新增行动');
 await page.getByRole('button',{name:'转录',exact:true}).click();expect((await readMeeting(page)).detailedSummary.actionItems).toEqual(['新增行动']);
});

async function database(electronApp: any, sql: string) {
 await electronApp.evaluate(({app}: any, sql: string)=>{
  const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'edit-fixture.cjs'));
  const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));db.exec(sql);db.close();
 },sql);
}
async function readMeeting(page: any) {return page.evaluate(()=>window.electronAPI.getMeetingDetails('editing-fixture'));}
async function fakeClipboard(page: any) {
 await page.evaluate(()=>{(window as any).__copied=[];Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text: string)=>{(window as any).__copied.push(text);}}});});
}

test('failed save retains input and blocks tab, actual return and copy until retry',async({electronApp,page})=>{
 await seed(electronApp);await open(page);await fakeClipboard(page);
 await database(electronApp,"CREATE TRIGGER fail_summary BEFORE UPDATE OF summary_json ON meetings BEGIN SELECT RAISE(ABORT,'fixture_save_failure'); END;");
 await edit(page,'摘要正文','**失败时保留文字**');
 await page.getByRole('button',{name:'转录',exact:true}).click();
 await expect(page.getByText('保存失败，输入已保留。请重试后再离开或复制导出。')).toBeVisible();
 await expect(page.getByLabel('摘要正文',{exact:true})).toContainText('失败时保留文字');
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();
 await expect(page.getByLabel('摘要正文',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'复制完整摘要',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__copied.length)).toBe(0);
 await page.screenshot({path:'.tmp/v28-t4/save-failure-retains-draft.png'});
 expect((await readMeeting(page)).detailedSummary.overview).toBe('**原始摘要**');
 await database(electronApp,'DROP TRIGGER fail_summary');
 await page.getByRole('button',{name:'重试保存',exact:true}).click();
 await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'复制完整摘要',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__copied[0])).toContain('失败时保留文字');
 expect((await readMeeting(page)).detailedSummary.overview).toBe('**失败时保留文字**');
});

test('immediate copy and actual Launcher return flush latest draft, followed by Word export',async({electronApp,page})=>{
 await seed(electronApp);await open(page);await fakeClipboard(page);
 await edit(page,'行动项 2 负责人','乙');await edit(page,'行动项 2 期限','明天');
 await page.screenshot({path:'.tmp/v28-t4/action-owner-deadline.png'});
 await edit(page,'摘要正文','**复制导出最新摘要**');
 await page.getByRole('button',{name:'复制完整摘要',exact:true}).click();
 const copied=await page.evaluate(()=>(window as any).__copied[0]);expect(copied).toContain('复制导出最新摘要');expect(copied).toContain('乙');expect(copied).toContain('明天');expect(copied).toContain('行动项已修改，草稿未自动更新');
 await edit(page,'会议标题','即时返回标题');
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();
 await expect(page.getByLabel('摘要正文',{exact:true})).toBeHidden();
 await expect(page.getByText('即时返回标题',{exact:true})).toBeVisible();
 expect((await readMeeting(page)).title).toBe('即时返回标题');
 const path=await electronApp.evaluate(({dialog,app}: any)=>{
  const path=process.getBuiltinModule('node:path').join(app.getPath('userData'),'fixture-export.docx');
  dialog.showSaveDialog=async()=>({canceled:false,filePath:path});return path;
 });
 const exported=await page.evaluate(()=>window.electronAPI.exportMeetingDocx('editing-fixture',false));
 expect(exported.success,JSON.stringify(exported)).toBe(true);
 const xml=await electronApp.evaluate(async(_: any,path: string)=>{
  const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'export-fixture.cjs'));
  const zip=await require('jszip').loadAsync(require('node:fs').readFileSync(path));return zip.file('word/document.xml').async('string');
 },path);
 for(const text of ['复制导出最新摘要','即时返回标题','负责人：乙','截止日期：明天','行动项已修改，草稿未自动更新','字符串任务','结构任务'])expect(xml).toContain(text);
 expect(xml.match(/结构任务/g)?.length).toBe(1);
});

test('conflict retains local input and explicit keep survives delayed generation',async({electronApp,page})=>{
 await seed(electronApp);await open(page);
 await electronApp.evaluate(({app,ipcMain}: any)=>{
  const handlers=(ipcMain as any)._invokeHandlers;const original=handlers.get('meeting-apply-edit');let injected=false;
  ipcMain.removeHandler('meeting-apply-edit');ipcMain.handle('meeting-apply-edit',async(event:any,request:any)=>{
   if(!injected){injected=true;
    const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'conflict-fixture.cjs'));
    const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
    const row=db.prepare("SELECT * FROM meetings WHERE id='editing-fixture'").get();const summary=JSON.parse(row.summary_json);summary.detailedSummary.overview='远端修改';
    const state=JSON.parse(row.edit_state_json);state.meetingRevision=(state.meetingRevision||0)+1;
    db.prepare('UPDATE meetings SET summary_json=?,edit_state_json=? WHERE id=?').run(JSON.stringify(summary),JSON.stringify(state),'editing-fixture');db.close();
   }
   return original(event,request);
  });
 });
 await edit(page,'摘要正文','本地草稿');
 await page.getByRole('button',{name:'转录',exact:true}).click();
 await expect(page.getByText('记录已变化，输入已保留。请选择重新加载或保留本次修改。')).toBeVisible();
 await expect(page.getByLabel('摘要正文',{exact:true})).toHaveText('本地草稿');
 await page.getByRole('button',{name:'保留本次修改',exact:true}).click();await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 await electronApp.evaluate(({app,BrowserWindow}: any)=>{
  const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'generation-fixture.cjs'));
  const db=Object.create(require('./dist-electron/electron/db/DatabaseManager.js').DatabaseManager.prototype);
  db.db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
  db.mergeGeneratedMeetingResult({id:'editing-fixture',title:'编辑测试会议',summary:'late',detailedSummary:{overview:'迟到生成',actionItems:['迟到任务'],keyPoints:['生成要点']}},0);
  db.db.close();
  BrowserWindow.getAllWindows().forEach((win: any)=>win.webContents.send('meetings-updated'));
 });
 await expect(page.getByLabel('摘要正文',{exact:true})).toHaveText('本地草稿');
 await expect(page.getByLabel('要点 1',{exact:true})).toHaveText('生成要点');
 expect((await readMeeting(page)).detailedSummary.overview).toBe('本地草稿');
});

test('in-flight rapid edits, same-revision notifications and identity share a serial queue',async({electronApp,page})=>{
 await seed(electronApp,5000);await open(page);
 await electronApp.evaluate(({ipcMain}: any)=>{
  const handlers=(ipcMain as any)._invokeHandlers;const original=handlers.get('meeting-apply-edit');
  (globalThis as any).__editRequests=[];(globalThis as any).__releaseEdit=null;
  ipcMain.removeHandler('meeting-apply-edit');
  ipcMain.handle('meeting-apply-edit',async(event: any,request: any)=>{
   (globalThis as any).__editRequests.push(request);
   if((globalThis as any).__editRequests.length===1)await new Promise(resolve=>{(globalThis as any).__releaseEdit=resolve;});
   return original(event,request);
  });
 });
 await edit(page,'摘要正文','第一次');
 await expect.poll(async()=>electronApp.evaluate(()=>(globalThis as any).__editRequests.length)).toBe(1);
 // Real input events continue while the first SQLite write is paused at its IPC boundary.
 await page.getByLabel('摘要正文',{exact:true}).fill('保存中再次修改');
 await page.getByLabel('会议标题',{exact:true}).click();await page.getByLabel('会议标题',{exact:true}).fill('并行字段标题');
 await electronApp.evaluate(({app,BrowserWindow}: any)=>{
  const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'notification-fixture.cjs'));
  const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
  const row=db.prepare("SELECT summary_json FROM meetings WHERE id='editing-fixture'").get();const summary=JSON.parse(row.summary_json);summary.detailedSummary.decisions=['同revision新结论'];
  db.prepare('UPDATE meetings SET summary_json=? WHERE id=?').run(JSON.stringify(summary),'editing-fixture');db.close();
  BrowserWindow.getAllWindows().forEach((win: any)=>win.webContents.send('meetings-updated'));
 });
 await expect(page.getByLabel('决策 1',{exact:true})).toHaveText('同revision新结论');
 await expect(page.getByLabel('摘要正文',{exact:true})).toHaveText('保存中再次修改');
 expect(await electronApp.evaluate(()=>(globalThis as any).__editRequests.length)).toBe(1);
 await electronApp.evaluate(()=>(globalThis as any).__releaseEdit());
 await page.getByRole('button',{name:'转录',exact:true}).click();
 expect(await page.locator('[data-transcript-row-key]').count()).toBeLessThan(40);
 await page.getByRole('button',{name:'身份未确认',exact:true}).first().click();await page.getByRole('menuitem',{name:'标记为我',exact:true}).click();
 await expect(page.getByText('身份已修改，已有摘要可能需要修正。')).toBeVisible();
 const saved=await readMeeting(page);expect(saved.transcript).toHaveLength(5000);expect(saved.title).toBe('并行字段标题');expect(saved.detailedSummary.overview).toBe('保存中再次修改');expect(saved.transcript[0].speakerIdentityCorrection.identity).toBe('me');
 const requests=await electronApp.evaluate(()=>(globalThis as any).__editRequests);
 expect(requests.map((request: any)=>request.expectedRevision)).toEqual(requests.map((_: any,index: number)=>index));
});

test('Chinese composition Enter keeps focus and saves completed text without adding a task',async({electronApp,page})=>{
 await seed(electronApp);await open(page);
 const owner=page.getByLabel('行动项 2 负责人',{exact:true});await owner.click();
 await owner.dispatchEvent('compositionstart');await owner.fill('中文姓名');
 await owner.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
 await expect(owner).toBeFocused();await owner.dispatchEvent('compositionend',{data:'中文姓名'});
 await page.getByRole('button',{name:'转录',exact:true}).click();
 const saved=await readMeeting(page);expect(saved.detailedSummary.actionItemsStructured).toHaveLength(2);expect(saved.detailedSummary.actionItemsStructured[1].owner).toBe('中文姓名');
});

async function eraseWithKeyboard(page: any, label: string) {
 const input=page.getByLabel(label,{exact:true});await input.click();await page.keyboard.press('ControlOrMeta+A');await page.keyboard.press('Backspace');return input;
}
test('review I1: keyboard clear pause and replacement retain action row plus owner and deadline',async({electronApp,page})=>{
 await seed(electronApp);await open(page);
 const row=await page.getByLabel('行动项 2 内容',{exact:true}).elementHandle();
 const content=await eraseWithKeyboard(page,'行动项 2 内容');
 await expect(content).toBeVisible();expect(await row!.evaluate(node=>node.isConnected)).toBe(true);
 await page.waitForTimeout(750); // Deliberately cross the autosave debounce with an empty intermediate input.
 await expect(content).toBeFocused();await expect(page.getByText('行动项内容无效，请填写具体内容或使用删除。',{exact:true})).toBeVisible();
 await page.screenshot({path:'.tmp/v28-t4/fix-round-1/empty-action-draft-retained.png'});
 await eraseWithKeyboard(page,'行动项 2 负责人');await page.keyboard.type('乙');
 await eraseWithKeyboard(page,'行动项 2 期限');
 await expect(content).toBeVisible();expect(await row!.evaluate(node=>node.isConnected)).toBe(true);
 await content.click();await page.keyboard.type('替换后的任务');
 await page.getByRole('button',{name:'转录',exact:true}).click();
 const saved=await readMeeting(page);expect(saved.detailedSummary.actionItemsStructured[1]).toMatchObject({id:'owned',text:'替换后的任务',owner:'乙',deadline:''});
 await page.getByRole('button',{name:'摘要',exact:true}).click();await expect(content).toHaveText('替换后的任务');
 await page.screenshot({path:'.tmp/v28-t4/fix-round-1/empty-action-replacement.png'});
});

test('review I2: section title typing composition and pause only migrate on final exact blur',async({electronApp,page})=>{
 await seed(electronApp);await open(page);
 const title=await eraseWithKeyboard(page,'分区 1 标题');const original=await title.elementHandle();
 await title.pressSequentially('下一步',{delay:80});await page.waitForTimeout(750);
 await expect(title).toBeFocused();expect(await original!.evaluate(node=>node.isConnected)).toBe(true);
 expect((await readMeeting(page)).detailedSummary.sections[0].title).toBe('会议结论');
 await title.pressSequentially('计划',{delay:80});await page.getByRole('button',{name:'摘要',exact:true}).click();
 expect((await readMeeting(page)).detailedSummary.sections[0]).toEqual({title:'下一步计划',bullets:['分区结论']});
 await eraseWithKeyboard(page,'分区 1 标题');await title.dispatchEvent('compositionstart');
 await title.fill('下一步');await title.dispatchEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,keyCode:229});
 await page.waitForTimeout(750);await expect(title).toBeFocused();
 await title.fill('下一步计划');await title.dispatchEvent('compositionend',{data:'下一步计划'});
 await page.getByRole('button',{name:'摘要',exact:true}).click();expect((await readMeeting(page)).detailedSummary.sections[0].title).toBe('下一步计划');
 await eraseWithKeyboard(page,'分区 1 标题');await title.pressSequentially('下一步',{delay:80});
 await page.waitForTimeout(750);await expect(title).toBeFocused();
 await page.getByRole('button',{name:'摘要',exact:true}).click();
 await expect(title).toHaveCount(0);const migrated=await readMeeting(page);
 expect(migrated.detailedSummary.sections).toEqual([]);expect(migrated.detailedSummary.actionItemsStructured.map((item:any)=>item.text)).toContain('分区结论');
 await page.screenshot({path:'.tmp/v28-t4/fix-round-1/section-final-blur-migration.png'});
});

test('review I3: failed identity then title input keeps retry and recovers copy plus actual return',async({electronApp,page})=>{
 await seed(electronApp);await open(page);await fakeClipboard(page);
 await database(electronApp,"CREATE TRIGGER fail_identity BEFORE UPDATE OF speaker_identity_correction_json ON transcripts BEGIN SELECT RAISE(ABORT,'fixture_identity_failure'); END;");
 await page.getByRole('button',{name:'转录',exact:true}).click();
 await page.getByRole('button',{name:'身份未确认',exact:true}).click();await page.getByRole('menuitem',{name:'标记为我',exact:true}).click();
 await expect(page.getByRole('button',{name:'重试保存',exact:true})).toBeVisible();
 await edit(page,'会议标题','身份失败后的标题');await page.waitForTimeout(750);
 await expect(page.getByRole('button',{name:'重试保存',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'复制完整转录',exact:true}).click();expect(await page.evaluate(()=>(window as any).__copied.length)).toBe(0);
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();await expect(page.getByLabel('会议标题',{exact:true})).toBeVisible();
 await page.screenshot({path:'.tmp/v28-t4/fix-round-1/identity-failure-with-title-draft.png'});
 await database(electronApp,'DROP TRIGGER fail_identity');await page.getByRole('button',{name:'重试保存',exact:true}).click();
 await expect(page.getByText('已保存',{exact:true})).toBeVisible();const saved=await readMeeting(page);
 expect(saved.title).toBe('身份失败后的标题');expect(saved.transcript[0].speakerIdentityCorrection.identity).toBe('me');
 await page.getByRole('button',{name:'复制完整转录',exact:true}).click();expect(await page.evaluate(()=>(window as any).__copied[0])).toContain('我: 原始转录');
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();await expect(page.getByLabel('会议标题',{exact:true})).toBeHidden();await expect(page.getByText('身份失败后的标题',{exact:true})).toBeVisible();
});

test('review I1 punctuation: pause preserves metadata and copy plus actual return wait for valid content',async({electronApp,page})=>{
 await seed(electronApp);await open(page);await fakeClipboard(page);
 const row=await page.getByLabel('行动项 2 内容',{exact:true}).elementHandle();
 const content=await eraseWithKeyboard(page,'行动项 2 内容');await page.keyboard.type('。');
 await page.waitForTimeout(750); // Pure punctuation must stay a draft past autosave.
 await expect(content).toBeFocused();expect(await row!.evaluate(node=>node.isConnected)).toBe(true);
 await expect(content).toHaveText('。');await expect(page.getByLabel('行动项 2 负责人',{exact:true})).toHaveText('甲');await expect(page.getByLabel('行动项 2 期限',{exact:true})).toHaveText('周五');
 await expect(page.getByText('行动项内容无效，请填写具体内容或使用删除。',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'复制完整摘要',exact:true}).click();expect(await page.evaluate(()=>(window as any).__copied.length)).toBe(0);
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();await expect(content).toBeVisible();expect(await row!.evaluate(node=>node.isConnected)).toBe(true);
 expect((await readMeeting(page)).detailedSummary.actionItemsStructured[1]).toMatchObject({id:'owned',text:'结构任务',owner:'甲',deadline:'周五'});
 await page.screenshot({path:'.tmp/v28-t4/fix-round-2/punctuation-draft-retained.png'});
 await content.click();await page.keyboard.type('补充任务。');
 await page.getByRole('button',{name:'复制完整摘要',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).__copied[0])).toContain('。补充任务。');
 expect((await readMeeting(page)).detailedSummary.actionItemsStructured[1]).toMatchObject({id:'owned',text:'。补充任务。',owner:'甲',deadline:'周五'});
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();await expect(content).toBeHidden();
});
