import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const read = path => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, jsx: ts.JsxEmit.ReactJSX } }).outputText;
function find(source, predicate) {
  const tree = ts.createSourceFile('source.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let result;
  function visit(node) { if (!result && predicate(node)) result = node; ts.forEachChild(node, visit); }
  visit(tree); assert.ok(result, 'production expression must exist'); return result.getText(tree);
}
function permissionModule({ failService, probeError = false } = {}) {
  const exports = {}, calls = [];
  vm.runInNewContext(compile(read('electron/permissions/macPermissionHealth.ts')), {
    exports, process: { platform: 'darwin' }, console: { warn() {}, error() {} },
    require(id) {
      if (id === 'electron') return { app: { isPackaged: true, getBundleID: () => 'com.cueup.test' },
        systemPreferences: { getMediaAccessStatus: () => 'granted' }, desktopCapturer: { async getSources() {
          if (probeError) throw new Error('temporary enumeration error'); return [{ id: 'screen:1' }];
        } } };
      if (id === 'child_process') return { execFile(file, args, callback) {
        calls.push(args[1]); callback(args[1] === failService ? new Error('reset rejected') : null, '', '');
      } };
      return require(id);
    },
  }); return { ...exports, calls };
}
test('partial TCC reset preserves progress and still requires restart', async () => {
  const module = permissionModule({ failService: 'AudioCapture' });
  const result = await module.repairMacTccPermissions('screen');
  assert.equal(result.success, false); assert.equal(result.commandsRun.length, 1);
  assert.equal(result.requiresRestart, true); assert.match(result.error, /部分/);
});
test('first reset failure changes no permissions and requires no restart', async () => {
  const result = await permissionModule({ failService: 'ScreenCapture' }).repairMacTccPermissions('screen');
  assert.equal(result.success, false); assert.equal(result.commandsRun.length, 0); assert.equal(result.requiresRestart, false);
});
test('temporary screen enumeration error is not classified as stale permission', async () => {
  const result = await permissionModule({ probeError: true }).resolveMacScreenPermissionHealth('test');
  assert.equal(result.staleGrantSuspected, false); assert.notEqual(result.recommendedFix, 'reset-tcc');
});
function quitFixture(saved, restart = true) {
  const events = [], appState = { restartAfterPermissionRepair: restart, setQuitting() {},
    getWindowHelper: () => ({ flushLauncherEdits: async () => { events.push('save'); return saved; } }),
    finishMeetingBeforeQuit: async () => events.push('finish'), disposeIdleResources: async () => {},
    processingHelper: { getLLMHelper: () => ({ scrubKeys() {} }) }, clearQueues() {}, getRAGManager: () => null };
  const call = find(read('electron/main.ts'), n => ts.isCallExpression(n) && n.expression.getText() === 'app.on' && n.arguments[0]?.text === 'before-quit');
  let beforeQuit; const exports = {};
  vm.runInNewContext(compile(`let quitCleanupPromise = null; let quitCleanupComplete = false; ${call}; exports.wait = () => quitCleanupPromise;`), {
    exports, appState, app: { on(_, callback) { beforeQuit = callback; }, quit() { events.push('quit'); }, relaunch() { events.push('relaunch'); } },
    console: { log() {}, error() {} }, OllamaManager: { getInstance: () => ({ stop() {} }) },
    require: () => ({ CredentialsManager: { getInstance: () => ({ scrubMemory() {} }) }, getImageOptimizer: () => ({ cleanupAll: async () => {} }) }),
  }); return { events, appState, async run() { beforeQuit({ preventDefault() {} }); await exports.wait(); } };
}
test('repair restart launches only after edit and meeting saves complete', async () => {
  const f = quitFixture(true); await f.run(); assert.deepEqual(f.events, ['save', 'finish', 'relaunch', 'quit']);
});
test('failed save cancels requested restart and retains the running app', async () => {
  const f = quitFixture(false); await f.run(); assert.deepEqual(f.events, ['save']); assert.equal(f.appState.restartAfterPermissionRepair, false);
});
test('restart IPC requests normal quit without forced exit or immediate relaunch', () => {
  const call = find(read('electron/ipcHandlers.ts'), n => ts.isCallExpression(n) && n.expression.getText() === 'safeHandle' && n.arguments[0]?.text === 'permissions:restart-after-repair');
  const appState = {}, events = []; let handler;
  vm.runInNewContext(compile(call), { safeHandle(_, callback) { handler = callback; }, appState,
    app: { quit() { events.push('quit'); }, relaunch() { events.push('relaunch'); }, exit() { events.push('exit'); } }, setImmediate: callback => callback() });
  handler(); assert.deepEqual(events, ['quit']); assert.equal(appState.restartAfterPermissionRepair, true);
});
for (const [path, name] of [['src/components/NativelyInterface.tsx', 'handleRepairTccPermission'], ['src/components/SettingsOverlay.tsx', 'handleRepairScreenTcc'], ['src/components/onboarding/PermissionsToaster.tsx', 'handleScreenRepair']]) {
  test(`${name}: partial reset offers restart and explains the partial failure`, async () => {
    const source = read(path);
    const declaration = find(source, n => ts.isVariableDeclaration(n) && n.name.getText() === name);
    let confirmation = '', restarted = false;
    const exports = {};
    vm.runInNewContext(compile(`const ${declaration}; exports.run = ${name};`), {
      exports, isRepairingTcc: false, isRepairingScreenTcc: false, systemAudioWarning: { kind: 'screen-recording-permission' },
      useCallback: f => f, setIsRepairingTcc() {}, setIsRepairingScreenTcc() {}, setRepairing() {}, setSystemAudioWarning() {}, refreshStatus: async () => {},
      window: { confirm(message) { confirmation = message; return true; }, alert() {}, electronAPI: {
        repairTccPermission: async () => ({ success: false, requiresRestart: true, error: '部分权限已重置' }),
        restartAfterTccRepair: async () => { restarted = true; return { success: true }; },
      } },
    });
    await exports.run(); assert.equal(restarted, true); assert.match(confirmation, /部分/);
  });
}
test('ordinary permission denial renders settings only; stale grants retain the reset action', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const branch = find(source, n => ts.isConditionalExpression(n) && n.condition.getText() === "systemAudioWarning.kind === 'screen-recording-permission'" && n.whenTrue.getText().includes('handleRepairTccPermission'));
  const exports = {};
  vm.runInNewContext(compile(`exports.render = systemAudioWarning => (${branch});`), {
    exports, require, isMac: true, isRepairingTcc: false, systemAudioRepairAction: 'repair-and-restart', handleRepairTccPermission() {},
  });
  const ordinary = renderToStaticMarkup(exports.render({ kind: 'screen-recording-permission', recommendedFix: 'open-settings' }));
  assert.match(ordinary, /打开设置/); assert.doesNotMatch(ordinary, /修复权限并重启/);
  const stale = renderToStaticMarkup(exports.render({ kind: 'screen-recording-permission', recommendedFix: 'reset-tcc' }));
  assert.match(stale, /修复权限并重启/);
});
test('settings ordinary denial opens OS settings; stale permission alone resets TCC', () => {
  const source = read('src/components/SettingsOverlay.tsx');
  const declaration = find(source, n => ts.isVariableDeclaration(n) && n.name.getText() === 'canRepairScreenTcc');
  const button = find(source, n => ts.isJsxElement(n) && n.openingElement.tagName.getText() === 'button' && n.getText().includes('handleRepairScreenTcc'));
  for (const reason of ['screen-recording-permission-denied', 'screen-recording-stale-grant']) {
    const exports = {}, events = [];
    vm.runInNewContext(compile(`const deviceFallbackNotice = { reason: ${JSON.stringify(reason)} }; const ${declaration}; exports.button = (${button});`), {
      exports, require, isMac: true, isKnownScreenRecordingFallback: true, isRepairingScreenTcc: false,
      handleRepairScreenTcc() { events.push('reset'); }, window: { electronAPI: { openExternal() { events.push('settings'); } } },
    });
    exports.button.props.onClick(); assert.deepEqual(events, [reason.endsWith('stale-grant') ? 'reset' : 'settings']);
    assert.match(renderToStaticMarkup(exports.button), reason.endsWith('stale-grant') ? /修复并重启/ : /打开设置/);
  }
});

test('normal quit never relaunches without a repair restart request', async () => {
  const f = quitFixture(true, false); await f.run(); assert.deepEqual(f.events, ['save', 'finish', 'quit']);
});
test('meeting persistence failure also cancels relaunch', async () => {
  const f = quitFixture(true);
  f.appState.finishMeetingBeforeQuit = async () => { throw new Error('write failed'); };
  await f.run(); assert.deepEqual(f.events, ['save']); assert.equal(f.appState.restartAfterPermissionRepair, false);
});
