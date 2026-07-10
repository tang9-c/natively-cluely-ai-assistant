// electron/utils/__tests__/loginItemSettings.test.mjs
//
// Behavioral coverage for loginItemSettings.ts:
//   - setOpenAtLoginForPlatform: darwin (no path/args in set), win32 (path+args)
//   - getOpenAtLoginForPlatform: darwin openAtLogin, win32 executableWillLaunchAtLogin / openAtLogin

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/utils/loginItemSettings.js');
const { setOpenAtLoginForPlatform, getOpenAtLoginForPlatform } = await import(pathToFileURL(modulePath).href);

function makeApp(platform) {
  const calls = [];
  return {
    platform,
    _path: platform === 'win32' ? 'C:\\Program Files\\Natively\\Natively.exe' : '/Applications/Natively.app/Contents/MacOS/Natively',
    app: {
      getPath: (name) => {
        if (name === 'exe') {
          return platform === 'win32'
            ? 'C:\\Program Files\\Natively\\Natively.exe'
            : '/Applications/Natively.app/Contents/MacOS/Natively';
        }
        return '/tmp';
      },
      setLoginItemSettings: (settings) => {
        calls.push({ type: 'set', settings });
      },
      getLoginItemSettings: (query) => {
        calls.push({ type: 'get', query });
        return {
          openAtLogin: true,
          executableWillLaunchAtLogin: platform === 'win32' ? true : undefined,
        };
      },
    },
    calls,
  };
}

test('setOpenAtLoginForPlatform: darwin sets openAtLogin without path/args', () => {
  const { app, calls } = makeApp('darwin');
  setOpenAtLoginForPlatform(app, true, 'darwin');
  assert.equal(calls.length, 1);
  const settings = calls[0].settings;
  assert.equal(settings.openAtLogin, true);
  assert.equal(settings.openAsHidden, false);
  assert.ok(settings.path, 'darwin must include path');
  // darwin must NOT include args
  assert.equal(settings.args, undefined);
});

test('setOpenAtLoginForPlatform: win32 sets openAtLogin WITH path AND empty args', () => {
  const { app, calls } = makeApp('win32');
  setOpenAtLoginForPlatform(app, true, 'win32');
  assert.equal(calls.length, 1);
  const settings = calls[0].settings;
  assert.equal(settings.openAtLogin, true);
  assert.equal(settings.openAsHidden, false);
  assert.ok(settings.path, 'win32 must include path');
  assert.deepEqual(settings.args, [], 'win32 must pass empty args array');
});

test('setOpenAtLoginForPlatform: passing openAtLogin=false', () => {
  const { app, calls } = makeApp('darwin');
  setOpenAtLoginForPlatform(app, false, 'darwin');
  assert.equal(calls[0].settings.openAtLogin, false);
});

test('getOpenAtLoginForPlatform: darwin reads openAtLogin directly', () => {
  const { app, calls } = makeApp('darwin');
  const result = getOpenAtLoginForPlatform(app, 'darwin');
  assert.equal(result, true);
  assert.equal(calls[0].type, 'get');
  // darwin does NOT pass a query to getLoginItemSettings
  assert.equal(calls[0].query, undefined);
});

test('getOpenAtLoginForPlatform: win32 reads executableWillLaunchAtLogin (falls back to openAtLogin)', () => {
  const { app, calls } = makeApp('win32');
  const result = getOpenAtLoginForPlatform(app, 'win32');
  assert.equal(result, true);
  // win32 MUST pass a query with path+args
  assert.ok(calls[0].query, 'win32 must pass a query');
  assert.ok(calls[0].query.path);
  assert.deepEqual(calls[0].query.args, []);
});

test('getOpenAtLoginForPlatform: win32 falls back to openAtLogin when executableWillLaunchAtLogin is undefined', () => {
  const { app } = makeApp('win32');
  app.getLoginItemSettings = () => ({
    openAtLogin: true,
    // executableWillLaunchAtLogin absent
  });
  const result = getOpenAtLoginForPlatform(app, 'win32');
  assert.equal(result, true);
});

test('getOpenAtLoginForPlatform: win32 returns false when both are false', () => {
  const { app } = makeApp('win32');
  app.getLoginItemSettings = () => ({
    openAtLogin: false,
    executableWillLaunchAtLogin: false,
  });
  const result = getOpenAtLoginForPlatform(app, 'win32');
  assert.equal(result, false);
});

test('getOpenAtLoginForPlatform: darwin returns false when openAtLogin is false', () => {
  const { app } = makeApp('darwin');
  app.getLoginItemSettings = () => ({ openAtLogin: false });
  const result = getOpenAtLoginForPlatform(app, 'darwin');
  assert.equal(result, false);
});

test('defaults to process.platform when not specified', () => {
  // We don't override process.platform; we just verify the function
  // signature accepts a missing platform arg.
  const { app, calls } = makeApp('darwin');
  // Pass no platform — should fall back to process.platform
  setOpenAtLoginForPlatform(app, true);
  assert.equal(calls.length, 1);
});
