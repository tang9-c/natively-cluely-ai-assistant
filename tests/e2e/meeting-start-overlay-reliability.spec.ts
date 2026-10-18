import { test, expect } from './fixtures';
import { quitElectron } from './quitElectron.mjs';

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

test('startup quit before opening a meeting editor does not wait on an absent save owner',async({electronApp})=>{
 // A startup window exists, but do not wait for renderer readiness or open an editor.
 await electronApp.firstWindow();
 const child=electronApp.process();let timeout: ReturnType<typeof setTimeout>;
 const exited=new Promise((resolve,reject)=>{timeout=setTimeout(()=>reject(new Error('startup quit did not finish')),15000);child.once('exit',(code,signal)=>resolve({code,signal}));});
 try{
  const state=await electronApp.evaluate(({BrowserWindow}:any)=>{
   const windows=BrowserWindow.getAllWindows();const loading=windows.some((win:any)=>win.webContents.isLoadingMainFrame());
   console.log('T7 startup quit state',JSON.stringify({windowCount:windows.length,loading}));
   return {windowCount:windows.length,loading};
  }).catch(()=>null);
  console.log('T7 startup quit state',JSON.stringify(state));
  await electronApp.evaluate(quitElectron).catch(()=>{});
  expect(await exited).toEqual({code:0,signal:null});
 }finally{clearTimeout(timeout!);}
});
