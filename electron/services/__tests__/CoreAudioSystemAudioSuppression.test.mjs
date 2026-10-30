import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('coreaudio system audio uses a dedicated low-threshold suppression profile', () => {
  const suppressor = read('native-module/src/silence_suppression.rs');
  const nativeLib = read('native-module/src/lib.rs');

  assert.match(suppressor, /pub fn for_coreaudio_system_audio\(\) -> Self/);
  assert.match(suppressor, /speech_threshold_rms:\s*5\.0/);
  assert.match(suppressor, /adaptive_min_floor:\s*1\.0/);
  assert.match(suppressor, /adaptive_multiplier:\s*1\.5/);

  assert.match(nativeLib, /stream\.backend_name\(\)\s*==\s*"coreaudio"/);
  assert.match(nativeLib, /SilenceSuppressionConfig::for_coreaudio_system_audio\(\)/);
});

test('system audio diagnostics distinguish raw capture from emitted STT silence', () => {
  const nativeLib = read('native-module/src/lib.rs');

  assert.match(nativeLib, /struct SystemAudioDiagnostics/);
  assert.match(nativeLib, /rawPeak=/);
  assert.match(nativeLib, /pcmPeak=/);
  assert.match(nativeLib, /sentPeak=/);
  assert.match(nativeLib, /silenceFrames=/);
  assert.match(nativeLib, /suppressedFrames=/);
  assert.match(nativeLib, /diagnostics\.record_raw\(&raw_batch\)/);
  assert.match(nativeLib, /diagnostics\.record_silence\(\)/);
});

test('CoreAudio zero-fill never infers audio denial from screen permission; SCK retains screen diagnostics', async () => {
  const main = read('electron/main.ts');
  const tree = ts.createSourceFile('main.ts', main, ts.ScriptTarget.Latest, true);
  const cls = tree.statements.find(node => ts.isClassDeclaration(node) && node.name.text === 'AppState');
  const method = cls.members.find(node => node.name?.getText(tree) === 'handleZeroFilledSystemAudio').getText(tree);
  let denied = false, backend = 'coreaudio', probes = 0;
  const context = { console: { warn() {} }, resolveMacScreenCaptureCapability: async () => { probes++; return { effectiveDenied: denied }; } };
  vm.runInNewContext(ts.transpileModule(`class Probe { ${method} };globalThis.Probe=Probe;`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const events = [];
  const capture = { getBackendName: () => backend, emit: (name, error) => events.push({ name, message: error.message }) };
  const probe = new context.Probe();
  Object.assign(probe, { systemAudioCapture: capture, isMeetingActive: true });
  for (const nonScreenBackend of ['coreaudio', 'wasapi', 'unknown']) {
    backend = nonScreenBackend;
    for (const screenDenied of [false, true]) {
      denied = screenDenied;
      await probe.handleZeroFilledSystemAudio(capture, '', 10_000);
      assert.deepEqual(events, []);
      assert.equal(probes, 0);
    }
  }
  backend = 'sck';
  await probe.handleZeroFilledSystemAudio(capture, '', 10_000);
  assert.deepEqual(events, [{ name: 'error', message: 'Screen recording permission denied' }]);
  probe.isMeetingActive = false;
  await probe.handleZeroFilledSystemAudio(capture, '', 10_000);
  assert.equal(events.length, 1);
});
