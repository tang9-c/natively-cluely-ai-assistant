import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { test } from 'node:test';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '../../..');
const main = ts.createSourceFile('main.ts', fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;

function findNode(predicate, source = main) {
  let found;
  function visit(node) {
    if (predicate(node)) found = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(found, 'production entry point must contain the behavior under test');
  return found;
}

function loadLogger(getPath) {
  const getter = findNode(node => ts.isVariableDeclaration(node) && node.name.getText(main) === 'getLogFile');
  const writer = findNode(node => ts.isFunctionDeclaration(node) && node.name?.text === 'logToFile');
  const declarations = [`const ${getter.getText(main)};`, writer.getText(main)];
  return vm.runInNewContext(compile(`let _logFile = null; const LOG_MAX_BYTES = 10 * 1024 * 1024; ${declarations.join('\n')}\nexports.write = logToFile;`), {
    app: { getPath }, fs, path, Date, exports: {},
  });
}

test('startup logging writes under app logs without requesting Documents access', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-boot-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logDir = path.join(dir, 'logs');
  const write = loadLogger(name => {
    if (name !== 'logs') throw new Error('protected user folder must not be requested at startup');
    return logDir;
  });
  write('fixture startup');
  const file = path.join(logDir, 'natively_debug.log');
  assert.equal(fs.existsSync(file), true, 'logging must work without protected folder authorization');
  assert.match(fs.readFileSync(file, 'utf8'), /fixture startup\n$/);
});

test('startup logging retries after Electron paths become available and still rotates oversized logs', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-boot-log-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  let ready = false;
  const write = loadLogger(name => {
    if (!ready || name !== 'logs') throw new Error('path unavailable');
    return dir;
  });
  assert.doesNotThrow(() => write('before ready'));
  ready = true;
  const file = path.join(dir, 'natively_debug.log');
  fs.writeFileSync(file, 'x'.repeat(10 * 1024 * 1024));
  write('after ready');
  assert.equal(fs.existsSync(`${file}.1`), true, 'oversized logs must rotate after paths become available');
  assert.equal(fs.statSync(`${file}.1`).size, 10 * 1024 * 1024);
  assert.match(fs.readFileSync(file, 'utf8'), /after ready\n$/);
});

test('log path and open-log IPC use the same unprotected application log directory', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-log-ipc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const logDir = path.join(dir, 'logs');
  const source = ts.createSourceFile('ipcHandlers.ts', fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8'), ts.ScriptTarget.Latest, true);
  let opened;
  const context = {
    app: { getPath(name) { if (name !== 'logs') throw new Error('Documents access forbidden'); return logDir; } },
    fs, path, shell: { async openPath(file) { opened = file; } },
  };
  const handler = channel => {
    const call = findNode(node => ts.isCallExpression(node) && node.expression.getText(source) === 'safeHandle' && node.arguments[0]?.text === channel, source);
    return vm.runInNewContext(compile(`exports.run = ${call.arguments[1].getText(source)}`), { ...context, exports: {} });
  };
  assert.equal(await handler('get-log-file-path')(), path.join(logDir, 'natively_debug.log'));
  const result = await handler('open-log-file')();
  assert.equal(result.success, true);
  assert.equal(opened, path.join(logDir, 'natively_debug.log'));
  assert.equal(fs.existsSync(opened), true);
});

function loadNative(fingerprint = () => 'a'.repeat(64), audioAvailable = false) {
  const native = {
    getHardwareId: fingerprint,
    verifyGumroadKey() {},
    getInputDevices() { if (audioAvailable) return []; throw new Error('microphone permission pending'); },
    getOutputDevices() { throw new Error('audio access must wait until use'); },
    SystemAudioCapture: class {},
    MicrophoneCapture: class {},
  };
  const exports = {};
  vm.runInNewContext(compile(fs.readFileSync(path.join(root, 'electron/audio/nativeModuleLoader.ts'), 'utf8')), {
    exports,
    process: { platform: 'darwin', arch: 'arm64', resourcesPath: '/fixture/Resources', env: {} },
    console: { log() {}, warn() {}, error() {} },
    require(name) {
      if (name === 'path') return path;
      if (name === 'electron') return { app: { getAppPath: () => '/fixture/app.asar', isPackaged: true } };
      if (name.endsWith('.node')) return native;
      throw new Error('optional settings unavailable');
    },
  });
  return { native, load: exports.loadNativeModule };
}

test('native module import remains available while microphone permission is pending', () => {
  const { load, native } = loadNative();
  assert.equal(load(), native, 'ABI validation must not enumerate audio devices before the UI exists');
  assert.equal(load(), native);
});

test('native functional check still rejects a broken or sealed-asar stub', () => {
  for (const fingerprint of [() => undefined, () => 'unknown', () => { throw new Error('native binding unavailable'); }]) {
    assert.equal(loadNative(fingerprint, true).load(), null);
  }
});

function activate({ visible = true, meeting = false, exists = true } = {}) {
  const state = { visible, focused: false, created: false, dockShown: false, toggled: false };
  const call = findNode(node => ts.isCallExpression(node) && node.expression.getText(main) === 'app.on' && node.arguments[0]?.text === 'activate');
  const appState = {
    getIsMeetingActive: () => meeting,
    getMainWindow: () => exists ? {} : null,
    createWindow: () => { state.created = true; },
    isVisible: () => state.visible,
    showMainWindow: () => { state.visible = true; state.focused = true; },
    toggleMainWindow: () => { state.visible = !state.visible; state.toggled = true; },
  };
  vm.runInNewContext(`(${call.arguments[1].getText(main)})()`, {
    appState, app: { dock: { show: () => { state.dockShown = true; } } },
    process: { platform: 'darwin' }, console: { log() {} },
  });
  return state;
}

test('explicit activation focuses an already visible launcher rather than leaving queued UI work occluded', () => {
  const state = activate();
  assert.equal(state.focused, true);
  assert.equal(state.visible, true);
  assert.equal(state.toggled, false);
});

test('explicit activation restores a hidden launcher with focus', () => {
  assert.equal(activate({ visible: false }).focused, true);
});

test('activation preserves passive meeting overlay and missing-window recovery', () => {
  const meeting = activate({ meeting: true });
  assert.equal(meeting.focused, false);
  assert.equal(meeting.dockShown, false);
  assert.equal(activate({ meeting: true, visible: false }).toggled, true);
  assert.equal(activate({ exists: false }).created, true);
});
