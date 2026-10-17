import { test, expect } from './fixtures';

async function seed(electronApp: any, transcriptCount = 1) {
 await electronApp.evaluate(({ app, clipboard, dialog }: any, transcriptCount: number) => {
  (globalThis as any).__minutesClipboard=[];
  clipboard.write=(data: any)=>{(globalThis as any).__minutesClipboard.push(data);};
  clipboard.writeText=(text: string)=>{(globalThis as any).__minutesClipboard.push({text});};
  dialog.showSaveDialog=async()=>({canceled:true});
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
 await share(page,'复制纪要');
 expect(await copiedMinutes(electronApp)).toHaveLength(0);
 await page.screenshot({path:'.tmp/v28-t4/save-failure-retains-draft.png'});
 expect((await readMeeting(page)).detailedSummary.overview).toBe('**原始摘要**');
 await database(electronApp,'DROP TRIGGER fail_summary');
 await page.getByRole('button',{name:'重试保存',exact:true}).click();
 await expect(page.getByText('已保存',{exact:true})).toBeVisible();
 await share(page,'复制纪要');
 expect((await copiedMinutes(electronApp))[0].text).toContain('失败时保留文字');
 expect((await readMeeting(page)).detailedSummary.overview).toBe('**失败时保留文字**');
});

test('immediate copy and actual Launcher return flush latest draft, followed by Word export',async({electronApp,page})=>{
 await seed(electronApp);await open(page);await fakeClipboard(page);
 await edit(page,'行动项 2 负责人','乙');await edit(page,'行动项 2 期限','明天');
 await page.screenshot({path:'.tmp/v28-t4/action-owner-deadline.png'});
 await edit(page,'摘要正文','**复制导出最新摘要**');
 await share(page,'复制纪要');
 const copied=(await copiedMinutes(electronApp))[0].text;expect(copied).toContain('复制导出最新摘要');expect(copied).toContain('乙');expect(copied).toContain('明天');expect(copied).not.toContain('原有跟进草稿');
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
 for(const text of ['复制导出最新摘要','即时返回标题','负责人：乙','截止日期：明天','字符串任务','结构任务'])expect(xml).toContain(text);
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
 await expect(page.getByText('记录已修改，摘要可能需要调整。')).toBeVisible();
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
 await expect(content).toBeFocused();await expect(page.getByText('内容无效，请保留有效转录或填写具体行动项。删除行动项请使用删除。',{exact:true})).toBeVisible();
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
 await page.getByRole('button',{name:'复制完整转录',exact:true}).click();expect(await copiedMinutes(electronApp)).toHaveLength(0);
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
 await expect(page.getByText('内容无效，请保留有效转录或填写具体行动项。删除行动项请使用删除。',{exact:true})).toBeVisible();
 await share(page,'复制纪要');expect(await copiedMinutes(electronApp)).toHaveLength(0);
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();await expect(content).toBeVisible();expect(await row!.evaluate(node=>node.isConnected)).toBe(true);
 expect((await readMeeting(page)).detailedSummary.actionItemsStructured[1]).toMatchObject({id:'owned',text:'结构任务',owner:'甲',deadline:'周五'});
 await page.screenshot({path:'.tmp/v28-t4/fix-round-2/punctuation-draft-retained.png'});
 await content.click();await page.keyboard.type('补充任务。');
 await share(page,'复制纪要');
 expect((await copiedMinutes(electronApp))[0].text).toContain('。补充任务。');
 expect((await readMeeting(page)).detailedSummary.actionItemsStructured[1]).toMatchObject({id:'owned',text:'。补充任务。',owner:'甲',deadline:'周五'});
 await page.getByRole('button',{name:'返回会议列表',exact:true}).click();await expect(content).toBeHidden();
});

async function share(page: any, action: string) {
 await page.getByRole('button',{name:'分享纪要',exact:true}).click();
 await page.getByRole('menuitem',{name:action,exact:true}).click();
}
async function copiedMinutes(electronApp: any) {return electronApp.evaluate(()=>(globalThis as any).__minutesClipboard || []);}
async function minutesClipboard(electronApp: any, fail = false) {
 await electronApp.evaluate(({clipboard,dialog}: any, fail: boolean)=>{
  (globalThis as any).__minutesClipboard=[];
  clipboard.write=(data: any)=>{if(fail)throw new Error('fixture_clipboard_failure');(globalThis as any).__minutesClipboard.push(data);};
  clipboard.writeText=()=>{throw new Error('Use intercepted rich clipboard boundary');};
  dialog.showSaveDialog=async()=>({canceled:true});
 },fail);
}

test('T6 concise share menu copies only saved minutes via main-process rich clipboard',async({electronApp,page})=>{
 await seed(electronApp);await minutesClipboard(electronApp);await open(page);
 await edit(page,'摘要正文','**星舟 Azure 最新纪要**\n\n## 私人问答\n私有回答\n\n## 要点\n公开信息');
 await page.getByRole('button',{name:'分享纪要',exact:true}).click();
 await expect(page.getByRole('menu',{name:'分享纪要',exact:true})).toBeVisible();
 await expect(page.getByRole('menuitem')).toHaveText(['复制纪要','导出 Word']);
 await expect(page.getByRole('button',{name:'复制完整摘要',exact:true})).toHaveCount(0);
 await page.screenshot({path:'.tmp/v28-t6/share-menu.png',animations:'disabled'});
 await page.getByRole('menuitem',{name:'复制纪要',exact:true}).click();
 await expect(page.getByText('已复制',{exact:true})).toBeVisible();
 const writes=await copiedMinutes(electronApp);expect(writes).toHaveLength(1);
 expect(writes[0].text).toContain('星舟 Azure 最新纪要');expect(writes[0].html).toContain('<h1>');expect(writes[0].html).toContain('<ul>');
 for(const secret of ['私有回答','原有跟进草稿','待确认问题','原始转录','**'])expect(writes[0].text).not.toContain(secret);
 expect(writes[0].text.match(/结构任务/g)).toHaveLength(1);
 const saved=await readMeeting(page);
 expect(saved.detailedSummary.overview).toContain('星舟 Azure 最新纪要');
 const stale=await page.evaluate(async(revision: number)=>(window.electronAPI as any).copyMeetingMinutes('editing-fixture',revision),saved.editState.meetingRevision-1);
 expect(stale).toEqual({success:false,error:'conflict'});expect(await copiedMinutes(electronApp)).toHaveLength(1);
 const invalid=await page.evaluate(async()=>(window.electronAPI as any).copyMeetingMinutes('editing-fixture',-1));
 expect(invalid).toEqual({success:false,error:'invalid_input'});
 await page.screenshot({path:'.tmp/v28-t6/share-copied.png',animations:'disabled'});
});

test('T6 IPC snapshots reject conflicts and preserve the selected saved version across a delayed dialog',async({electronApp,page})=>{
 await seed(electronApp);await minutesClipboard(electronApp);await open(page);
 expect(await page.evaluate(()=>typeof (window.electronAPI as any).copyMeetingMinutes)).toBe('function');
 expect(await page.evaluate(async()=>(window.electronAPI as any).exportMeetingDocx('editing-fixture',{profile:'minutes'}))).toEqual({success:false,error:'invalid_input'});
 const before=await readMeeting(page);const revision=before.editState.meetingRevision;
 expect(await page.evaluate(async(revision:number)=>window.electronAPI.copyMeetingMinutes('editing-fixture',revision),revision)).toEqual({success:true});
 const copied=(await copiedMinutes(electronApp))[0].text;
 expect(await page.evaluate(async()=> (window.electronAPI as any).copyMeetingMinutes('missing',0))).toEqual({success:false,error:'meeting_not_found'});
 await electronApp.evaluate(({dialog,app}: any)=>{
  (globalThis as any).__saveDialogOpened=false;(globalThis as any).__saveDialogRelease=null;
  dialog.showSaveDialog=async()=>{(globalThis as any).__saveDialogOpened=true;return new Promise(resolve=>{(globalThis as any).__saveDialogRelease=()=>resolve({canceled:false,filePath:process.getBuiltinModule('node:path').join(app.getPath('userData'),'snapshot.docx')});});};
 });
 const pending=page.evaluate(async(revision: number)=>(window.electronAPI as any).exportMeetingDocx('editing-fixture',{profile:'minutes',expectedRevision:revision}),revision);
 await expect.poll(()=>electronApp.evaluate(()=>(globalThis as any).__saveDialogOpened)).toBe(true);
 const edited=await page.evaluate(async(revision: number)=>window.electronAPI.applyMeetingEdit({meetingId:'editing-fixture',expectedRevision:revision,operation:{type:'summary',patch:{overview:'保存对话框之后的新版本'}}}),revision);
 expect(edited.ok).toBe(true);
 await electronApp.evaluate(()=>(globalThis as any).__saveDialogRelease());
 const result=await pending;expect(result.success).toBe(true);
 const xml=await electronApp.evaluate(async(_: any,file: string)=>{const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'snapshot.cjs'));const zip=await require('jszip').loadAsync(require('node:fs').readFileSync(file));return zip.file('word/document.xml').async('string');},result.filePath);
 expect(xml).toContain('原始摘要');expect(xml).not.toContain('保存对话框之后的新版本');expect(xml).not.toContain('原有跟进草稿');
 const paragraphs=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(([p])=>[...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(([,t])=>t.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')).join('')).filter(Boolean);
 expect(paragraphs).toEqual(copied.split('\n').filter(Boolean).map((line:string)=>line.replace(/^• /,'')));
 const conflict=await page.evaluate(async(revision: number)=>(window.electronAPI as any).exportMeetingDocx('editing-fixture',{profile:'minutes',expectedRevision:revision}),revision);
 expect(conflict).toEqual({success:false,error:'conflict'});
 await minutesClipboard(electronApp,true);
 const failed=await page.evaluate(async(revision: number)=>(window.electronAPI as any).copyMeetingMinutes('editing-fixture',revision),revision+1);
 expect(failed).toEqual({success:false,error:'copy_failed'});expect(await copiedMinutes(electronApp)).toHaveLength(0);
});

test.afterEach(async({electronApp},testInfo)=>{
 if(!testInfo.title.startsWith('T6 '))return;
 const child=electronApp.process();
 let timeout: ReturnType<typeof setTimeout>;
 const exited=new Promise<{code:number|null;signal:string|null}>((resolve,reject)=>{
  timeout=setTimeout(()=>reject(new Error('T6 Electron did not quit naturally')),15000);
  child.once('exit',(code,signal)=>resolve({code,signal}));
 });
 try {
  await electronApp.evaluate(({app}: any)=>app.quit()).catch(()=>{});
  const result=await exited;console.log('T6 natural Electron exit',JSON.stringify(result));
  expect(result).toEqual({code:0,signal:null});
 } finally {clearTimeout(timeout!);}
});

test('T6 copy failure and Word cancellation, write failure and success have accurate feedback',async({electronApp,page})=>{
 await seed(electronApp);await minutesClipboard(electronApp,true);await open(page);
 await share(page,'复制纪要');await expect(page.getByText('复制失败，请重试',{exact:true})).toBeVisible();
 await expect(page.getByText('已复制',{exact:true})).toHaveCount(0);expect(await copiedMinutes(electronApp)).toHaveLength(0);
 await page.screenshot({path:'.tmp/v28-t6/clipboard-failure.png',animations:'disabled'});
 await minutesClipboard(electronApp);
 await share(page,'导出 Word');await expect(page.getByRole('button',{name:'分享纪要',exact:true})).toBeEnabled();
 await expect(page.getByText('已导出',{exact:true})).toHaveCount(0);await expect(page.getByText('导出失败，请重试',{exact:true})).toHaveCount(0);
 await page.screenshot({path:'.tmp/v28-t6/word-cancelled.png',animations:'disabled'});
 await electronApp.evaluate(({dialog,app}: any)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:process.getBuiltinModule('node:path').join(app.getPath('userData'),'missing-directory','fail.docx')});});
 await share(page,'导出 Word');await expect(page.getByText('导出失败，请重试',{exact:true})).toBeVisible();await expect(page.getByText('已导出',{exact:true})).toHaveCount(0);
 await page.screenshot({path:'.tmp/v28-t6/word-failure.png',animations:'disabled'});
 await electronApp.evaluate(({dialog,app}: any)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:process.getBuiltinModule('node:path').join(app.getPath('userData'),'success.docx')});});
 await share(page,'导出 Word');await expect(page.getByText('已导出',{exact:true})).toBeVisible();
 await page.screenshot({path:'.tmp/v28-t6/word-success.png',animations:'disabled'});
});

test('T6 share waits for all rapid edits in the shared queue before creating a DB snapshot',async({electronApp,page})=>{
 await seed(electronApp);await minutesClipboard(electronApp);await open(page);
 await electronApp.evaluate(({ipcMain}: any)=>{
  const original=(ipcMain as any)._invokeHandlers.get('meeting-apply-edit');let count=0;
  (globalThis as any).__releaseShareEdit=null;
  ipcMain.removeHandler('meeting-apply-edit');ipcMain.handle('meeting-apply-edit',async(event:any,request:any)=>{
   if(++count===1)await new Promise(resolve=>{(globalThis as any).__releaseShareEdit=resolve;});return original(event,request);
  });
 });
 await edit(page,'摘要正文','保存中的版本');
 await expect.poll(()=>electronApp.evaluate(()=>typeof (globalThis as any).__releaseShareEdit)).toBe('function');
 await share(page,'复制纪要');
 expect(await copiedMinutes(electronApp)).toHaveLength(0);
 await page.getByLabel('摘要正文',{exact:true}).click();await page.getByLabel('摘要正文',{exact:true}).fill('快速编辑最终版本');
 await electronApp.evaluate(()=>(globalThis as any).__releaseShareEdit());
 await expect(page.getByText('已复制',{exact:true})).toBeVisible();
 expect(await copiedMinutes(electronApp)).toHaveLength(1);expect((await copiedMinutes(electronApp))[0].text).toContain('快速编辑最终版本');expect((await copiedMinutes(electronApp))[0].text).not.toContain('保存中的版本');
 expect((await readMeeting(page)).detailedSummary.overview).toBe('快速编辑最终版本');
 await page.screenshot({path:'.tmp/v28-t6/rapid-edits-latest.png',animations:'disabled'});
});

test('T6 revision conflict refreshes saved state and requires an explicit retry before copy',async({electronApp,page})=>{
 await seed(electronApp);await minutesClipboard(electronApp);await open(page);
 await electronApp.evaluate(({ipcMain,app}: any)=>{
  const original=(ipcMain as any)._invokeHandlers.get('copy-meeting-minutes');let first=true;
  ipcMain.removeHandler('copy-meeting-minutes');ipcMain.handle('copy-meeting-minutes',async(event:any,id:string,revision:number)=>{
   if(first){first=false;const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'share-conflict.cjs'));
    const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
    const row=db.prepare('SELECT summary_json,edit_state_json FROM meetings WHERE id=?').get(id);const summary=JSON.parse(row.summary_json);summary.detailedSummary.overview='冲突后的最新已保存纪要';const state=JSON.parse(row.edit_state_json);state.meetingRevision=(state.meetingRevision||0)+1;
    db.prepare('UPDATE meetings SET summary_json=?,edit_state_json=? WHERE id=?').run(JSON.stringify(summary),JSON.stringify(state),id);db.close();
   }return original(event,id,revision);
  });
 });
 await share(page,'复制纪要');await expect(page.getByText('记录已变化，已同步最新内容，请重试。',{exact:true})).toBeVisible();
 expect(await copiedMinutes(electronApp)).toHaveLength(0);await expect(page.getByLabel('摘要正文',{exact:true})).toHaveText('冲突后的最新已保存纪要');
 await page.screenshot({path:'.tmp/v28-t6/share-conflict.png',animations:'disabled'});
 await share(page,'复制纪要');await expect(page.getByText('已复制',{exact:true})).toBeVisible();expect((await copiedMinutes(electronApp))[0].text).toContain('冲突后的最新已保存纪要');
});

test('T6 fix1 stored legacy actions and authoritative v3 empty lists reach actual copy and Word IPC unchanged',async({electronApp,page})=>{
 await seed(electronApp);await minutesClipboard(electronApp);
 const markdown='## 概要\n公开会议事实\n\n## 行动项\n- 唯一Markdown任务\n\n## 私人问答（仅自己可见）\nPRIVATE\n\n**要点**\nPRIVATE_BOLD';
 const cases=[
  {summary:{legacySummary:'',detailedSummary:{overview:markdown}},actions:true},
  {summary:{legacySummary:markdown},actions:true},
  {summary:{legacySummary:'',detailedSummary:{schemaVersion:3,overview:markdown,keyPoints:[],actionItems:['过期任务'],actionItemsStructured:[]}},actions:false},
 ];
 for(const entry of cases){
  await minutesClipboard(electronApp);
  await electronApp.evaluate(({app,dialog}: any,summary: any)=>{
   const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'fix1-share.cjs'));
   const db=new (require('better-sqlite3'))(require('node:path').join(app.getPath('userData'),'natively.db'));
   db.prepare('UPDATE meetings SET summary_json=? WHERE id=?').run(JSON.stringify(summary),'editing-fixture');db.close();
   dialog.showSaveDialog=async()=>({canceled:false,filePath:require('node:path').join(app.getPath('userData'),'fix1-minutes.docx')});
  },entry.summary);
  const defaultMeeting=await readMeeting(page);
  if(entry.summary.detailedSummary)expect(defaultMeeting.detailedSummary.schemaVersion).toBe(3);
  const revision=defaultMeeting.editState.meetingRevision;
  expect(await page.evaluate(async(revision:number)=>window.electronAPI.copyMeetingMinutes('editing-fixture',revision),revision)).toEqual({success:true});
  const writes=await copiedMinutes(electronApp);expect(writes).toHaveLength(1);
  const want=['会议概述','公开会议事实',...(entry.actions?['行动项','唯一Markdown任务']:[])];
  expect(writes[0].text.split('\n').slice(2).map((text:string)=>text.replace(/^• /,''))).toEqual(want);
  const decode=(text:string)=>text.replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
  expect([...writes[0].html.matchAll(/<(?:h1|h2|p|li)>(.*?)<\/(?:h1|h2|p|li)>/g)].slice(2).map((match:any)=>decode(match[1]))).toEqual(want);
  for(const legacySignature of [false,true]){
   const exported=await page.evaluate(async({revision,legacySignature}:any)=>window.electronAPI.exportMeetingDocx('editing-fixture',legacySignature?false:{profile:'minutes',expectedRevision:revision}),{revision,legacySignature});
   expect(exported.success).toBe(true);
   const xml=await electronApp.evaluate(async(_:any,file:string)=>{const require=process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(process.cwd(),'fix1-word.cjs'));const zip=await require('jszip').loadAsync(require('node:fs').readFileSync(file));return zip.file('word/document.xml').async('string');},exported.filePath);
   const paragraphs=[...xml.matchAll(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)].map(([p]:any)=>[...p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(([,text]:any)=>decode(text)).join('')).filter(Boolean);
   expect(paragraphs.slice(2)).toEqual(want);
   expect(paragraphs).toEqual(writes[0].text.split('\n').map((text:string)=>text.replace(/^• /,'')));
  }
 }
});
