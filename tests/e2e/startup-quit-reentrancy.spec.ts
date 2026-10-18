import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { offlineElectronEnv, prepareOfflineElectronGuard, verifyOfflineElectronGuard } from './offlineElectronGuard.mjs';
import { quitElectron } from './quitElectron.mjs';

test('quit request during native window construction returns before closing the window', async () => {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'cueup-quit-reentry-')));
  const resultPath = path.join(directory, 'result.json');
  const guard = await prepareOfflineElectronGuard(directory);
  const entry = path.join(directory, 'main.cjs');
  await fs.writeFile(entry, `
const { app, BrowserWindow } = require('electron');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const result = {};
const quit = ${quitElectron.toString()};
globalThis.runWindowQuitRegression = () => {
  const emit = EventEmitter.prototype.emit;
  let constructing = true;
  EventEmitter.prototype.emit = function(event, ...args) {
    if (event === 'bounds-changed' && constructing && !result.requestedDuringConstruction) {
      result.requestedDuringConstruction = true;
      quit({ app });
    }
    return emit.call(this, event, ...args);
  };
  try {
    new BrowserWindow({ show: false, width: 640, height: 480 });
    result.constructed = true;
  } finally {
    constructing = false;
    EventEmitter.prototype.emit = emit;
  }
};
app.on('will-quit', () => {
  result.willQuit = true;
  fs.writeFileSync(${JSON.stringify(resultPath)}, JSON.stringify(result));
});
`);
  const app = await electron.launch({ args: ['-r', guard, entry], cwd: directory, env: offlineElectronEnv(directory) });
  const child = app.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const exited = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error('reentrant quit did not finish')), 10_000);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  try {
    await verifyOfflineElectronGuard(app, directory);
    await app.evaluate(() => (globalThis as any).runWindowQuitRegression()).catch(() => {});
    expect(await exited).toEqual({ code: 0, signal: null });
    expect(JSON.parse(await fs.readFile(resultPath, 'utf8'))).toEqual({
      requestedDuringConstruction: true, constructed: true, willQuit: true,
    });
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) {
      await app.close().catch(() => {});
    }
    await fs.rm(directory, { recursive: true, force: true });
  }
});
