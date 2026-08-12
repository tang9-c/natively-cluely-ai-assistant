import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const modulePath = path.join(root, 'dist-electron/electron/services/AdaptivePreloadManager.js');

class FakeClock {
  now = 0;
  nextId = 0;
  timers = new Map();

  setTimeout = (callback, delay) => {
    const id = ++this.nextId;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimeout = id => this.timers.delete(id);

  async advance(ms) {
    const end = this.now + ms;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      this.timers.delete(next[0]);
      this.now = next[1].at;
      await next[1].callback();
    }
    this.now = end;
  }
}

function harness({ heavy = false } = {}) {
  const clock = new FakeClock();
  const events = [];
  const { AdaptivePreloadManager } = require(modulePath);
  const manager = new AdaptivePreloadManager({
    preload: async selection => events.push(`preload:${selection.provider}:${selection.modelId}`),
    release: async () => events.push('release'),
    isHeavyWorkActive: () => heavy,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    idlePreloadDelayMs: 100,
    heavyWorkRetryMs: 50,
    idleReleaseDelayMs: 300,
  });
  return { clock, events, manager, setHeavy: value => { heavy = value; } };
}

const senseVoice = {
  provider: 'local-sensevoice',
  modelId: 'sensevoice-small',
  modelDownloaded: true,
};

test('idle startup preloads a downloaded local SenseVoice model', async () => {
  const h = harness();
  h.manager.scheduleLocalSttPreload(senseVoice);
  await h.clock.advance(99);
  assert.deepEqual(h.events, []);
  await h.clock.advance(1);
  assert.deepEqual(h.events, ['preload:local-sensevoice:sensevoice-small']);
});

test('cloud STT and missing local models are not preloaded', async () => {
  const h = harness();
  h.manager.scheduleLocalSttPreload({ provider: 'qcloud-stt', modelDownloaded: true });
  await h.clock.advance(200);
  h.manager.scheduleLocalSttPreload({ ...senseVoice, modelDownloaded: false });
  await h.clock.advance(200);
  assert.deepEqual(h.events, []);
});

test('heavy indexing defers preload until the system becomes idle', async () => {
  const h = harness({ heavy: true });
  h.manager.scheduleLocalSttPreload(senseVoice);
  await h.clock.advance(150);
  assert.deepEqual(h.events, []);
  h.setHeavy(false);
  await h.clock.advance(50);
  assert.deepEqual(h.events, ['preload:local-sensevoice:sensevoice-small']);
});

test('meeting start cancels delayed release so a short restart reuses the warm model', async () => {
  const h = harness();
  h.manager.scheduleLocalSttPreload(senseVoice);
  await h.clock.advance(100);
  h.manager.notifyMeetingStopped();
  await h.clock.advance(299);
  h.manager.notifyMeetingStarted();
  await h.clock.advance(1);
  assert.deepEqual(h.events, ['preload:local-sensevoice:sensevoice-small']);
});

test('meeting stop keeps the model warm and releases it after the idle timeout', async () => {
  const h = harness();
  h.manager.scheduleLocalSttPreload(senseVoice);
  await h.clock.advance(100);
  h.manager.notifyMeetingStarted();
  h.manager.notifyMeetingStopped();
  await h.clock.advance(299);
  assert.equal(h.events.includes('release'), false);
  await h.clock.advance(1);
  assert.equal(h.events.at(-1), 'release');
});

test('application disposal immediately releases warm resources and cancels timers', async () => {
  const h = harness();
  h.manager.scheduleLocalSttPreload(senseVoice);
  await h.clock.advance(100);
  h.manager.notifyMeetingStopped();
  await h.manager.disposeIdleResources();
  await h.clock.advance(500);
  assert.deepEqual(h.events, ['preload:local-sensevoice:sensevoice-small', 'release']);
});

test('application disposal releases a model whose preload is still in flight', async () => {
  const clock = new FakeClock();
  const events = [];
  let finishPreload;
  const preloadGate = new Promise(resolve => { finishPreload = resolve; });
  const { AdaptivePreloadManager } = require(modulePath);
  const manager = new AdaptivePreloadManager({
    preload: async () => {
      events.push('preload');
      await preloadGate;
    },
    release: async () => events.push('release'),
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
    idlePreloadDelayMs: 0,
  });
  manager.scheduleLocalSttPreload(senseVoice);
  await clock.advance(0);
  const disposing = manager.disposeIdleResources();
  finishPreload();
  await disposing;
  assert.deepEqual(events, ['preload', 'release']);
});

test('crashed warm resource is invalidated and retried while idle', async () => {
  const h = harness();
  h.manager.scheduleLocalSttPreload(senseVoice);
  await h.clock.advance(100);
  h.manager.notifyPreloadedResourceInvalidated();
  await h.clock.advance(49);
  assert.equal(h.events.length, 1);
  await h.clock.advance(1);
  assert.deepEqual(h.events, [
    'preload:local-sensevoice:sensevoice-small',
    'preload:local-sensevoice:sensevoice-small',
  ]);
});

test('startup no longer pre-creates settings or cropper windows', () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.doesNotMatch(source, /settingsWindowHelper\.preloadWindow\(\)/);
  assert.doesNotMatch(source, /cropperWindowHelper\.preload\(\)/);
});

test('main wires adaptive preload to startup, meeting lifecycle, and application quit', () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(source, /new AdaptivePreloadManager\(/);
  assert.match(source, /scheduleLocalSttPreload\(/);
  assert.match(source, /adaptivePreloadManager\.notifyMeetingStarted\(\)/);
  assert.match(source, /adaptivePreloadManager\.notifyMeetingStopped\(\)/);
  assert.match(source, /adaptivePreloadManager\.disposeIdleResources\(\)/);
  assert.doesNotMatch(source, /Local Whisper worker in the background/);
  assert.ok(
    source.indexOf('adaptivePreloadManager.notifyMeetingStarted()')
      > source.indexOf("ensureMacMicrophoneAccess('meeting start')"),
    'a rejected meeting start must not leave adaptive preload in meeting-active state',
  );
  assert.match(
    source,
    /void this\.ragManager\.startLiveIndexing\('live-meeting-current'\)\.catch/,
    'lazy embedding startup must not delay or fail the audio startup path',
  );
  assert.ok(
    source.indexOf('adaptivePreloadManager.notifyMeetingStarted()')
      > source.indexOf('this.isMeetingActive = true'),
    'meeting-active preload state must only be committed with meeting state',
  );
  const audioFailureHandler = source.slice(
    source.indexOf("console.error('[Main] Error initializing audio pipeline:'"),
    source.indexOf('}, 0); // Defer to next event loop tick'),
  );
  assert.match(audioFailureHandler, /this\.isMeetingActive = false/);
  assert.match(audioFailureHandler, /adaptivePreloadManager\.notifyMeetingStopped\(\)/);
});

test('SenseVoice model lifecycle reschedules adaptive preload', () => {
  const source = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const senseVoiceHandlers = source.slice(source.indexOf("safeHandle('local-sensevoice-delete-model'"), source.indexOf("safeHandle(\n    'test-llm-connection'"));
  assert.ok((senseVoiceHandlers.match(/scheduleAdaptiveLocalSttPreload\(\)/g) ?? []).length >= 3);
});

test('SenseVoice runtime and adaptive preload use one shared worker configuration builder', () => {
  const source = fs.readFileSync(path.join(root, 'electron/audio/sensevoice/LocalSenseVoiceSTT.ts'), 'utf8');
  assert.match(source, /export function createSenseVoiceWorkerConfig/);
  assert.match(source, /workerPool\.acquire\(createSenseVoiceWorkerConfig\(/);
});
