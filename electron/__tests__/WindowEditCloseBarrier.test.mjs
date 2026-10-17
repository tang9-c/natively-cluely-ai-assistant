import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { EventEmitter } from 'node:events';
import ts from 'typescript';

function harness() {
 const source=fs.readFileSync(new URL('../WindowHelper.ts',import.meta.url),'utf8');
 const tree=ts.createSourceFile('WindowHelper.ts',source,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(node=>ts.isClassDeclaration(node)&&node.name.text==='WindowHelper');
 const method=cls.members.find(node=>node.name?.getText(tree)==='flushLauncherEdits').getText(tree);
 const ipcMain=new EventEmitter();const timers=new Map();let next=0;
 const context={ipcMain,setTimeout:callback=>{timers.set(++next,callback);return next;},clearTimeout:id=>timers.delete(id)};
 vm.runInNewContext(ts.transpileModule(`class Barrier { ${method} };globalThis.Barrier=Barrier;`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,context);
 const window=new EventEmitter();let destroyed=false;const sent=[];
 window.isDestroyed=()=>destroyed;window.webContents={mainFrame:{},send:(...args)=>sent.push(args)};
 const helper=new context.Barrier();Object.assign(helper,{launcherWindow:window,launcherEditFlush:null,editFlushRequest:0});
 const reply=(id,ok,sender=window.webContents,frame=sender.mainFrame)=>ipcMain.emit('meeting-edits-flushed',{sender,senderFrame:frame},id,ok);
 const clean=()=>{assert.equal(ipcMain.listenerCount('meeting-edits-flushed'),0);assert.equal(window.listenerCount('closed'),0);assert.equal(timers.size,0);};
 return {helper,window,sent,reply,clean,timers,destroy:()=>{destroyed=true;window.emit('closed');}};
}

test('close barrier shares duplicate requests and rejects wrong sender, subframe and stale replies',async()=>{
 const h=harness();const first=h.helper.flushLauncherEdits();assert.equal(h.helper.flushLauncherEdits(),first);
 const id=h.sent[0][1];let settled=false;first.then(()=>{settled=true;});
 h.reply(id,true,{mainFrame:{}});h.reply(id,true,h.window.webContents,{});h.reply(id-1,true);
 await Promise.resolve();assert.equal(settled,false);
 h.reply(id,false);assert.equal(await first,false);h.clean();
 const second=h.helper.flushLauncherEdits();h.reply(id,true);await Promise.resolve();assert.equal(h.sent.length,2);
 h.reply(h.sent[1][1],true);assert.equal(await second,true);h.clean();
});
test('close barrier times out without closing, ignores late success and permits a fresh retry',async()=>{
 const h=harness();const first=h.helper.flushLauncherEdits();const id=h.sent[0][1];
 [...h.timers.values()][0]();assert.equal(await first,false);assert.equal(h.sent[1][2],true);h.clean();
 h.reply(id,true);const retry=h.helper.flushLauncherEdits();h.reply(id,true);h.reply(h.sent[2][1],true);
 assert.equal(await retry,true);h.clean();
});
test('destroying the owned window clears all pending listeners and timers',async()=>{
 const h=harness();const pending=h.helper.flushLauncherEdits();h.destroy();assert.equal(await pending,false);h.clean();
});
