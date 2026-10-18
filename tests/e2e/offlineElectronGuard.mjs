import fs from 'node:fs/promises';
import path from 'node:path';

export function offlineElectronEnv(userDataDir) {
  return {
    PATH: process.env.PATH,
    HOME: path.join(userDataDir, 'home'),
    TMPDIR: path.join(userDataDir, 'tmp'),
    LANG: 'en_US.UTF-8',
    NODE_ENV: 'development',
    ELECTRON_ENABLE_LOGGING: '1',
    ELECTRON_E2E: '1',
    ELECTRON_E2E_SKIP_AUDIO_START: '1',
    ELECTRON_E2E_MEETING_PREPARATION_FIXTURES: '1',
  };
}

export async function prepareOfflineElectronGuard(userDataDir) {
  const appDataDir = path.join(userDataDir, 'isolated-app-data');
  for (const directory of ['isolated-app-data', 'home', 'tmp', 'documents', 'crashes', 'session']) {
    await fs.mkdir(path.join(userDataDir, directory), { recursive: true });
  }
  await fs.writeFile(path.join(userDataDir, '.cueup-stt-quality-isolated'), 'e2e synthetic only\n');
  const guardPath = path.join(userDataDir, 'offline-boundaries.cjs');
  await fs.writeFile(guardPath, `
const path = require('node:path');
const { app, net, session } = require('electron');
const userDataDir = ${JSON.stringify(userDataDir)};
const appDataDir = ${JSON.stringify(appDataDir)};
const setPath = app.setPath.bind(app);
app.setPath = (name, value) => {
  if (['userData', 'appData', 'home', 'documents', 'crashDumps', 'sessionData'].includes(name) && !path.resolve(value).startsWith(userDataDir + path.sep) && path.resolve(value) !== userDataDir) throw new Error('E2E data path escape blocked');
  return setPath(name, value);
};
app.setPath('appData', appDataDir);
app.setPath('userData', userDataDir);
for (const [name, directory] of Object.entries({ home: 'home', documents: 'documents', crashDumps: 'crashes', sessionData: 'session' })) app.setPath(name, path.join(userDataDir, directory));
const state = globalThis.__e2eIsolation = { userDataDir, appDataDir, blockedCalls: 0 };
const blocked = () => { state.blockedCalls++; throw new Error('E2E external boundary disabled'); };
blocked.__e2eBlocked = true;
for (const name of ['node:http', 'node:https']) {
  const protocol = require(name); protocol.request = blocked; protocol.get = blocked;
}
globalThis.fetch = blocked;
net.request = blocked; net.fetch = blocked;
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) require('node:child_process')[method] = blocked;
app.whenReady().then(() => session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
  const url = new URL(details.url);
  const localVite = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '5180';
  callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !localVite });
}));
console.log('[E2E isolation] bootstrap guard active');
`);
  return guardPath;
}

export async function verifyOfflineElectronGuard(electronApp, userDataDir) {
  return electronApp.evaluate(({ app, net }, expectedPath) => {
    const state = globalThis.__e2eIsolation;
    const path = process.getBuiltinModule('node:path');
    if (process.cwd() !== expectedPath || process.env.HOME !== path.join(expectedPath, 'home') || process.env.TMPDIR !== path.join(expectedPath, 'tmp')) throw new Error('E2E environment not isolated');
    for (const [name, directory] of Object.entries({ home: 'home', documents: 'documents', crashDumps: 'crashes', sessionData: 'session' })) {
      if (app.getPath(name) !== path.join(expectedPath, directory)) throw new Error('E2E filesystem path not isolated');
    }
    if (!state || app.getPath('userData') !== expectedPath || app.getPath('appData') !== state.appDataDir || !state.appDataDir.startsWith(expectedPath + process.getBuiltinModule('node:path').sep)) throw new Error('E2E isolation not installed before main');
    const req = process.getBuiltinModule('node:module').createRequire(process.getBuiltinModule('node:path').join(expectedPath, 'guard-check.cjs'));
    if (!req('node:fs').existsSync(req('node:path').join(expectedPath, '.cueup-stt-quality-isolated'))) throw new Error('E2E migration marker missing');
    const checks = [req('node:http').request, req('node:http').get, req('node:https').request, req('node:https').get, globalThis.fetch, net.request, net.fetch, ...['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'].map(name => req('node:child_process')[name])];
    if (checks.some(fn => fn.__e2eBlocked !== true)) throw new Error('E2E boundary guard incomplete');
    const before = state.blockedCalls;
    for (const fn of checks) {
      try { fn(); throw new Error('E2E boundary unexpectedly allowed'); }
      catch (error) { if (error.message !== 'E2E external boundary disabled') throw error; }
    }
    return { active: true, isolatedPaths: true, migrationMarker: true, boundaryChecks: checks.length, blocked: state.blockedCalls - before };
  }, userDataDir);
}
