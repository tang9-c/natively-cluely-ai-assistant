import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { OnboardingService } = require('../../../dist-electron/electron/services/onboarding/OnboardingService.js');
const { LocalSttWorkerPool } = require('../../../dist-electron/electron/audio/LocalSttWorkerPool.js');
let validation;
try { validation = require('../../../dist-electron/electron/services/onboarding/OnboardingValidation.js'); }
catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
const legacy = { legacySeenStartup: false, legacyPermissionsShown: false };
export function harness(execute) {
  assert.ok(validation, 'onboarding validator is not implemented');
  let stored; const h = { identity: 'speech-v1', active: false, timers: new Set(), executions: 0 };
  h.service = new OnboardingService({ load: () => stored, save: p => stored = p,
    readLegacyEvidence: () => ({ hasNonDemoMeeting: false, hasSavedServiceConfiguration: false }),
    readConfiguration: target => ({ provider: h.provider ?? (target === 'stt' ? 'local-sensevoice' : 'doubao'), modelId: 'selected', configIdentity: h.identity, ...(h.checkError ? { errorCode: h.checkError } : {}) }),
    readChecks: async () => { throw new Error('passive checks must not run validation'); }, now: () => 10, platform: () => 'darwin' });
  h.service.initialize(legacy);
  h.validator = new validation.OnboardingValidation({ service: h.service, isBusy: () => h.active,
    execute: async (...args) => { h.executions++; return execute(...args); },
    setTimeout: fn => { h.timers.add(fn); return fn; }, clearTimeout: fn => h.timers.delete(fn), now: () => 100 });
  return h;
}
function deferred() { let resolve; const promise = new Promise(r => resolve = r); return { promise, resolve }; }
const ok = { provider: 'local-sensevoice', modelId: 'selected', depth: 'model_load' };
test('waits for actual lease ready, reuses the keyed pool, releases validation lease without transcribing', async () => {
  assert.ok(validation, 'onboarding validator is not implemented');
  const worker = new EventEmitter(); worker.messages = []; worker.postMessage = m => worker.messages.push(m); worker.terminate = () => {};
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const config = { provider: 'sensevoice', modelId: 'selected', executionProviders: ['cpu'], dtype: 'fp32', sessionConfig: {},
    workerPath: '/unused', initMessage: { type: 'init' }, audioField: 'samples' };
  const warm = pool.acquire(config, 'mic');
  const executor = validation.createSpeechExecutor({ isCached: () => true, acquireLease: () => pool.acquire(config, 'mic'),
    testSavedConnection: () => { throw new Error('must not contact cloud'); } });
  const h = harness((_target, check, signal) => executor(check, signal));
  let settled = false; const pending = h.validator.validate('stt', 0).then(r => { settled = true; return r; });
  await new Promise(setImmediate); assert.equal(settled, false); assert.equal(h.service.getSnapshot().checks.stt.status, 'checking');
  worker.emit('message', { type: 'ready' }); assert.equal((await pending).success, true);
  assert.equal(pool.getRuntimeStats().leaseCount, 1); assert.deepEqual(worker.messages, [{ type: 'init' }]);
  assert.equal(h.service.getSnapshot().checks.stt.status, 'verified'); await warm.release();
});
test('deduplicates identical requests and rejects active meetings, stale revisions and changed configuration', async () => {
  const d = deferred(); const h = harness(() => d.promise);
  h.active = true; assert.equal((await h.validator.validate('stt', 0)).errorCode, 'busy'); assert.equal(h.executions, 0);
  h.active = false; assert.equal((await h.validator.validate('stt', 5)).errorCode, 'stale_config');
  const a = h.validator.validate('stt', 0); const b = h.validator.validate('stt', 0);
  assert.equal(a, b); await new Promise(setImmediate); assert.equal(h.executions, 1);
  h.identity = 'speech-v2'; d.resolve(ok);
  assert.equal((await a).errorCode, 'stale_config'); assert.equal(h.service.getSnapshot().progress.validationReceipts.stt, undefined);
});
test('60-second timeout aborts and keeps busy until the underlying resource really ends; late success is ignored', async () => {
  const d = deferred(); let signal; const h = harness((_t, _c, s) => { signal = s; return d.promise; });
  const pending = h.validator.validate('stt', 0); await new Promise(setImmediate);
  [...h.timers][0](); assert.equal((await pending).errorCode, 'timeout'); assert.equal(signal.aborted, true);
  assert.equal((await h.validator.validate('stt', 0)).errorCode, 'busy');
  d.resolve(ok); await new Promise(setImmediate);
  assert.notEqual(h.service.getSnapshot().progress.validationReceipts.stt?.result, 'passed'); assert.equal(h.timers.size, 0);
});
test('missing files, worker failure and unsupported providers never produce success receipts', async () => {
  assert.ok(validation);
  for (const [provider, cached, errorCode] of [['local-sensevoice', false, 'model_missing'], ['google', true, 'unsupported_check']]) {
    const executor = validation.createSpeechExecutor({ isCached: () => cached, acquireLease: () => { throw new Error('should not acquire'); }, testSavedConnection: async () => ({ success: true }) });
    await assert.rejects(executor({ provider, modelId: 'selected' }, new AbortController().signal), e => e.code === errorCode);
  }
  const h = harness(() => { throw Object.assign(new Error('private worker output'), { code: 'model_load_failed' }); });
  assert.equal((await h.validator.validate('stt', 0)).errorCode, 'model_load_failed');
  assert.equal(h.service.getSnapshot().progress.validationReceipts.stt.result, 'failed');
  assert.doesNotMatch(JSON.stringify(h.service.getSnapshot()), /private worker/);
});
for (const provider of ['doubao-auc', 'qcloud-stt']) test(`${provider} validates the saved configuration through the existing detector`, async () => {
  assert.ok(validation); const signal = new AbortController().signal; let called;
  const executor = validation.createSpeechExecutor({ isCached: () => false, acquireLease: () => { throw new Error('no local worker'); },
    testSavedConnection: async (p, s) => { called = [p, s]; return { success: true }; } });
  const result = await executor({ provider, modelId: provider }, signal);
  assert.deepEqual(called, [provider, signal]); assert.equal(result.depth, 'credential_access');
});
test('downloads survive view reloads, update before initialization, and expose only safe errors', () => {
  const h = harness(async () => ok);
  assert.equal(typeof h.service.updateDownload, 'function', 'download snapshots are missing');
  h.service.updateDownload({ modelId: 'selected', status: 'running', progress: 20 });
  assert.equal(h.service.getSnapshot().downloads[0].progress, 20);
  const secondView = h.service.getSnapshot(); assert.equal(secondView.downloads[0].status, 'running');
  h.service.updateDownload({ modelId: 'selected', status: 'failed', errorCode: 'network_error' });
  assert.equal(h.service.getSnapshot().downloads[0].errorCode, 'network_error');
});
test('selected model download blocks validation without acquiring resources', async () => {
  const h = harness(async () => ok); h.service.updateDownload({ modelId: 'selected', status: 'running' });
  assert.equal((await h.validator.validate('stt', 0)).errorCode, 'busy'); assert.equal(h.executions, 0);
});

test('actual model mutation gate rejects active meetings, validators and downloads before deleting', async () => {
  const { mainMethods } = await import('./helpers/onboardingRuntime.mjs');
  const App = mainMethods(['prepareLocalModelMutation']); const app = new App(); let released = 0;
  app.isOnboardingBusy = () => false; app.onboardingValidation = { isBusy: () => false };
  app.onboardingService = { isDownloadActive: () => false };
  app.adaptivePreloadManager = { notifyPreloadedResourceInvalidated() {} }; app.releasePreloadedLocalStt = async () => released++;
  await app.prepareLocalModelMutation('model'); assert.equal(released, 1);
  for (const block of [() => app.isOnboardingBusy = () => true,
    () => app.onboardingValidation.isBusy = () => true, () => app.onboardingService.isDownloadActive = () => true]) {
    block(); await assert.rejects(app.prepareLocalModelMutation('model'), /busy/); assert.equal(released, 1);
    app.isOnboardingBusy = () => false; app.onboardingValidation.isBusy = () => false;
  }
});
test('Whisper actual download handler cleans bookkeeping and reports completion after sender closes', async () => {
  const { ipcHandler } = await import('./helpers/onboardingRuntime.mjs'); let worker; const downloads = []; const active = new Set();
  class Worker extends EventEmitter { constructor() { super(); worker = this; } postMessage() {} terminate() {} }
  const handler = ipcHandler('local-whisper-start-download', { activeWhisperDownloads: active,
    appState: { prepareLocalModelMutation: async () => {}, onboardingService: { updateDownload: d => downloads.push(d) } },
    require: id => id === 'worker_threads' ? { Worker } : id.includes('inferenceConfig') ? { buildWorkerInitMessage: () => ({ type: 'init' }) } : { resolveWhisperWorkerPath: () => '/fake' } });
  const sender = { isDestroyed: () => true, send: () => { throw new Error('closed sender must not receive'); } };
  assert.equal((await handler({ sender }, 'selected')).success, true);
  worker.emit('message', { type: 'progress', progress: 42 }); worker.emit('message', { type: 'ready' });
  assert.equal(active.size, 0); assert.equal(downloads.at(-1).status, 'completed');
  await handler({ sender }, 'selected'); worker.emit('error', new Error('private failure'));
  assert.equal(active.size, 0); assert.equal(downloads.at(-1).status, 'failed'); assert.doesNotMatch(JSON.stringify(downloads), /private failure/);
});
test('Whisper duplicate starts cannot pass the asynchronous resource-release gate twice', async () => {
  const { ipcHandler } = await import('./helpers/onboardingRuntime.mjs'); const gate = deferred(); let workers = 0;
  class Worker extends EventEmitter { constructor() { super(); workers++; } postMessage() {} }
  const handler = ipcHandler('local-whisper-start-download', { activeWhisperDownloads: new Set(),
    appState: { prepareLocalModelMutation: () => gate.promise }, require: id => id === 'worker_threads' ? { Worker }
      : id.includes('inferenceConfig') ? { buildWorkerInitMessage: () => ({}) } : { resolveWhisperWorkerPath: () => '/fake' } });
  const event = { sender: { isDestroyed: () => true } }; const first = handler(event, 'one'), second = handler(event, 'one');
  gate.resolve(); const results = await Promise.all([first, second]);
  assert.equal(workers, 1); assert.equal(results.filter(r => r.success).length, 1);
});
test('storage model deletion goes through the same main resource gate', async () => {
  const { ipcHandler } = await import('./helpers/onboardingRuntime.mjs'); let deleted = 0;
  const handler = ipcHandler('storage:delete-downloaded-model', { appState: { prepareLocalModelMutation: async () => { throw new Error('busy'); } },
    storageUsageService: { deleteDownloadedModel: async () => { deleted++; return { success: true }; } } });
  const result = await handler({}, 'sensevoice', 'selected'); assert.equal(result.success, false); assert.equal(deleted, 0);
});

test('old Whisper worker exit/progress cannot clobber a newer download of the same model', async () => {
  const { ipcHandler } = await import('./helpers/onboardingRuntime.mjs'); const workers = [], downloads = [], active = new Set();
  class Worker extends EventEmitter { constructor() { super(); workers.push(this); } postMessage() {} terminate() {} }
  const handler = ipcHandler('local-whisper-start-download', { activeWhisperDownloads: active,
    appState: { prepareLocalModelMutation: async () => {}, onboardingService: { updateDownload: d => downloads.push(d) } },
    require: id => id === 'worker_threads' ? { Worker } : id.includes('inferenceConfig') ? { buildWorkerInitMessage: () => ({}) } : { resolveWhisperWorkerPath: () => '/fake' } });
  const event = { sender: { isDestroyed: () => true } };
  await handler(event, 'one'); workers[0].emit('message', { type: 'ready' });
  await handler(event, 'one'); const before = downloads.length;
  workers[0].emit('exit', 0); workers[0].emit('message', { type: 'progress', progress: 100 }); workers[0].emit('error', new Error('old'));
  assert.equal(active.has('one'), true); assert.equal(downloads.length, before);
  workers[1].emit('message', { type: 'ready' }); assert.equal(active.has('one'), false);
});
test('timeout releases a real waiting worker lease and emits no transcription requests', async () => {
  assert.ok(validation); const worker = new EventEmitter(); let terminated = 0; const messages = [];
  worker.postMessage = m => messages.push(m); worker.terminate = () => terminated++;
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const config = { provider: 'sensevoice', modelId: 'selected', executionProviders: ['cpu'], dtype: 'fp32', sessionConfig: {},
    workerPath: '/unused', initMessage: { type: 'init' }, audioField: 'samples' };
  const run = validation.createSpeechExecutor({ isCached: () => true, acquireLease: () => pool.acquire(config, 'mic'), testSavedConnection: async () => ({ success: false }) });
  const h = harness((_target, check, signal) => run(check, signal)); const pending = h.validator.validate('stt', 0);
  await new Promise(setImmediate); [...h.timers][0](); assert.equal((await pending).errorCode, 'timeout');
  await new Promise(setImmediate); assert.equal(pool.getRuntimeStats().leaseCount, 0); assert.equal(terminated, 1);
  assert.deepEqual(messages, [{ type: 'init' }]);
});
test('pre-initialization download state is available to the first initialized view', () => {
  let stored; const service = new OnboardingService({ load: () => stored, save: p => stored = p, now: () => 1, platform: () => 'test',
    readLegacyEvidence: () => ({ hasNonDemoMeeting: false, hasSavedServiceConfiguration: false }), readChecks: async () => { throw new Error('not called'); } });
  service.updateDownload({ modelId: 'selected', status: 'running', progress: 15 });
  assert.equal(service.initialize(legacy).downloads[0].progress, 15);
});

test('Doubao AUC HTTP 200 with a business failure header cannot certify saved credentials', async () => {
  const { localIpcFunction } = await import('./helpers/onboardingRuntime.mjs');
  const run = localIpcFunction('runSttConnectionTest', { require: name => name === 'axios'
    ? { post: async () => ({ status: 200, headers: { 'x-api-status-code': '45000000' } }) } : function FormData() {},
    DOUBAO_AUC_SUBMIT_ENDPOINT: 'https://fixed.test', toSafeNetworkDiagnostic: () => ({}),
    validationErrorCode: validation.validationErrorCode, classifyNetworkError: () => ({ userMessage: 'unavailable' }) });
  const result = await run('doubao-auc', 'test-saved-key'); assert.equal(result.success, false);
});

test('unsupported historical STT cannot get stuck asking to resave an unversioned credential', async () => {
  const run = validation.createSpeechExecutor({ isCached: () => false, acquireLease: () => { throw new Error('no lease'); }, testSavedConnection: async () => ({ success: false }) });
  const h = harness((_target, check, signal) => run(check, signal)); h.provider = 'google'; h.checkError = 'credentials_missing';
  assert.equal((await h.validator.validate('stt', 0)).errorCode, 'unsupported_check');
  assert.equal(h.service.getSnapshot().checks.stt.errorCode, 'unsupported_check');
});

test('credential-version persistence failure is storage_failed and sends no validation request', async () => {
  const h = harness(async () => ok); let requests = 0;
  const validator = new validation.OnboardingValidation({ service: h.service, isBusy: () => false,
    prepare: () => { throw Object.assign(new Error('private filesystem path'), { code: 'ENOENT' }); },
    execute: async () => { requests++; return ok; } });
  const result = await validator.validate('stt', 0);
  assert.equal(result.errorCode, 'storage_failed'); assert.equal(requests, 0);
});
