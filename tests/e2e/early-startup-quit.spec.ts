import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { offlineElectronEnv, prepareOfflineElectronGuard, verifyOfflineElectronGuard } from './offlineElectronGuard.mjs';

test('zero-window startup request remains an app quit when window close handlers are installed', async ({}, testInfo) => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cueup-early-quit-')));
  let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
  let child: ReturnType<NonNullable<typeof app>['process']> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const guard = await prepareOfflineElectronGuard(directory);
    await fs.appendFile(guard, `
const fs = require('node:fs');
const { BrowserWindow, Tray, ipcMain } = require('electron');
const events = globalThis.__earlyQuitEvents = [];
const record = (event, extra = {}) => events.push({event, ...extra});
// Hold only the product's bootstrap continuation; the real Electron ready still runs.
const whenReady = app.whenReady.bind(app);
app.whenReady = () => {
  const pending = whenReady();
  if (!new Error().stack.includes('initializeApp')) return pending;
  return pending.then(() => new Promise(resolve => { globalThis.__releaseEarlyStartup = resolve; }));
};
// Both native windows and their close handlers exist at this startup boundary.
const setMenu = Tray.prototype.setContextMenu;
let requested = false;
Tray.prototype.setContextMenu = function(...args) {
  const result = setMenu.apply(this, args);
  if (!requested) {
    requested = true;
    record('quit-request', {windows: BrowserWindow.getAllWindows().length});
    app.quit();
  }
  return result;
};
ipcMain.on('meeting-edits-flushed', (_event, id, ok) => record('flush-reply', {id, ok}));
app.on('will-quit', () => {
  record('will-quit');
  fs.writeFileSync(path.join(userDataDir, 'quit-events.json'), JSON.stringify(events));
});
`);
    app = await electron.launch({args: ['-r', guard, process.cwd()], cwd: directory, env: offlineElectronEnv(directory)});
    child = app.process();
    await verifyOfflineElectronGuard(app, directory);
    const state = await app.evaluate(({BrowserWindow}) => ({
      windows: BrowserWindow.getAllWindows().length,
      gated: typeof (globalThis as any).__releaseEarlyStartup === 'function',
    }));
    expect(state).toEqual({windows: 0, gated: true});
    const exited = new Promise(resolve => {
      if (child!.exitCode !== null || child!.signalCode !== null) resolve({code: child!.exitCode, signal: child!.signalCode});
      else child!.once('exit', (code, signal) => resolve({code, signal}));
    });
    await app.evaluate(() => (globalThis as any).__releaseEarlyStartup()).catch(() => {});
    const result = await Promise.race([
      exited,
      new Promise(resolve => { timeout = setTimeout(() => resolve({timeout: true}), 15_000); }),
    ]);
    if ((result as any).timeout) {
      const diagnostic = await app.evaluate(({BrowserWindow}) => ({
        events: (globalThis as any).__earlyQuitEvents,
        remainingWindows: BrowserWindow.getAllWindows().length,
      }));
      await testInfo.attach('early-quit', {body: JSON.stringify(diagnostic), contentType: 'application/json'});
      console.log('early quit timeout', JSON.stringify(diagnostic));
    }
    expect(result).toEqual({code: 0, signal: null});
    const events = JSON.parse(await fs.readFile(path.join(directory, 'quit-events.json'), 'utf8'));
    expect(events[0]).toEqual({event: 'quit-request', windows: 2});
    expect(events).toContainEqual({event: 'will-quit'});
    expect(events.some((event: any) => event.event === 'flush-reply' && event.ok === true)).toBe(true);
  } finally {
    clearTimeout(timeout);
    if (app && child && child.exitCode === null && child.signalCode === null) {
      await app.evaluate(({app}) => app.exit(71)).catch(() => {});
      await new Promise(resolve => {
        if (child!.exitCode !== null || child!.signalCode !== null) resolve(undefined);
        else child!.once('exit', resolve);
      });
    }
    await fs.rm(directory, {recursive: true, force: true});
  }
});
