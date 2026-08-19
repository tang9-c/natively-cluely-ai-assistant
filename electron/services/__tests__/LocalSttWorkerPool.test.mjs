import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const { LocalSttWorkerPool, LocalSttWorkerError } = require(
  path.join(root, 'dist-electron/electron/audio/LocalSttWorkerPool.js'),
);

class FakeWorker extends EventEmitter {
  messages = [];
  terminated = 0;
  pending = [];

  postMessage(message) {
    this.messages.push(message);
    if (message.type === 'init') queueMicrotask(() => this.emit('message', { type: 'ready' }));
    if (message.type === 'transcribe') this.pending.push(message);
  }

  completeNext(text) {
    const message = this.pending.shift();
    this.emit('message', { type: message.streaming ? 'partial' : 'result', taskId: message.taskId, text });
  }

  terminate() {
    this.terminated += 1;
  }
}

const config = (modelId = 'model-a', dtype = 'q8') => ({
  provider: 'whisper',
  modelId,
  executionProviders: ['cpu'],
  dtype,
  sessionConfig: { numThreads: 4 },
  workerPath: '/fake/worker.js',
  initMessage: { type: 'init', modelId },
  audioField: 'audio',
});

const tick = () => new Promise(resolve => setImmediate(resolve));

test('worker pool reports workers, leases, active tasks, and queued tasks', async () => {
  const worker = new FakeWorker();
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const mic = pool.acquire(config(), 'mic');
  const system = pool.acquire(config(), 'system');
  await tick();
  const active = mic.transcribe(new Float32Array([1]), { taskId: 'active' });
  const queued = system.transcribe(new Float32Array([2]), { taskId: 'queued' });
  await tick();
  assert.deepEqual(pool.getRuntimeStats(), {
    workerCount: 1,
    leaseCount: 2,
    activeTasks: 1,
    queuedTasks: 1,
  });
  worker.completeNext('active');
  await active;
  await tick();
  worker.completeNext('queued');
  await queued;
  await Promise.all([mic.release(), system.release()]);
});

test('same complete worker key shares one worker across mic and system channels', async () => {
  const workers = [];
  const pool = new LocalSttWorkerPool({ workerFactory: () => workers.push(new FakeWorker()) && workers.at(-1) });
  const mic = pool.acquire(config(), 'mic');
  const system = pool.acquire(config(), 'system');
  await tick();
  assert.equal(workers.length, 1);
  await mic.release();
  assert.equal(workers[0].terminated, 0);
  await system.release();
  assert.equal(workers[0].terminated, 1);
});

test('late shared leases receive the original hardware provider diagnostics', async () => {
  const worker = new FakeWorker();
  worker.postMessage = function postMessage(message) {
    this.messages.push(message);
    if (message.type === 'init') {
      queueMicrotask(() => this.emit('message', {
        type: 'ready',
        providerRequested: 'coreml',
        providerActual: 'cpu',
        fallbackReason: 'candidate_initialization_failed',
        initializationMs: 321,
      }));
    }
  };
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const mic = pool.acquire(config(), 'mic');
  await tick();
  const system = pool.acquire(config(), 'system');
  const ready = await new Promise(resolve => system.once('message', resolve));
  assert.deepEqual(ready, {
    type: 'ready',
    providerRequested: 'coreml',
    providerActual: 'cpu',
    fallbackReason: 'candidate_initialization_failed',
    initializationMs: 321,
  });
  await Promise.all([mic.release(), system.release()]);
});

test('different model or inference configuration creates separate workers', async () => {
  const workers = [];
  const pool = new LocalSttWorkerPool({ workerFactory: () => workers.push(new FakeWorker()) && workers.at(-1) });
  const leases = [
    pool.acquire(config('model-a'), 'mic'),
    pool.acquire(config('model-b'), 'system'),
    pool.acquire(config('model-a', 'fp32'), 'system'),
  ];
  await tick();
  assert.equal(workers.length, 3);
  await Promise.all(leases.map(lease => lease.release()));
});

test('serializes tasks and routes each result to the requesting channel without cross-talk', async () => {
  const worker = new FakeWorker();
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const mic = pool.acquire(config(), 'mic');
  const system = pool.acquire(config(), 'system');
  await tick();

  const micResult = mic.transcribe(new Float32Array([1]), { taskId: 'same-id', language: 'zh' });
  const systemResult = system.transcribe(new Float32Array([2]), { taskId: 'same-id', language: 'en' });
  await tick();
  assert.equal(worker.pending.length, 1, 'only one inference may be active per model session');
  worker.completeNext('mic-result');
  assert.equal((await micResult).text, 'mic-result');
  await tick();
  assert.equal(worker.pending.length, 1);
  worker.completeNext('system-result');
  assert.deepEqual(await systemResult, { type: 'result', taskId: 'same-id', text: 'system-result', channelId: 'system' });
  await Promise.all([mic.release(), system.release()]);
});

test('releasing one lease keeps the shared worker alive for the other lease', async () => {
  const worker = new FakeWorker();
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const mic = pool.acquire(config(), 'mic');
  const system = pool.acquire(config(), 'system');
  await tick();
  await mic.release();
  const result = system.transcribe(new Float32Array([2]), { taskId: 'system-1' });
  await tick();
  worker.completeNext('still-running');
  assert.equal((await result).text, 'still-running');
  assert.equal(worker.terminated, 0);
  await system.release();
  assert.equal(worker.terminated, 1);
});

test('flush waits only for tasks submitted by that lease', async () => {
  const worker = new FakeWorker();
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const mic = pool.acquire(config(), 'mic');
  const system = pool.acquire(config(), 'system');
  await tick();
  const micTask = mic.transcribe(new Float32Array([1]), { taskId: 'mic-1' });
  const systemTask = system.transcribe(new Float32Array([2]), { taskId: 'system-1' });
  let micFlushed = false;
  const flushed = mic.flush().then(() => { micFlushed = true; });
  await tick();
  worker.completeNext('mic');
  await micTask;
  await flushed;
  assert.equal(micFlushed, true);
  assert.equal(worker.pending.length, 1);
  worker.completeNext('system');
  await systemTask;
  await Promise.all([mic.release(), system.release()]);
});

test('reuses the cached prompt and only switches it when the queued channel context changes', async () => {
  const worker = new FakeWorker();
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const mic = pool.acquire(config(), 'mic');
  await tick();
  const first = mic.transcribe(new Float32Array([1]), { taskId: 'one', prompt: 'shared context' });
  await tick();
  worker.completeNext('one');
  await first;
  const second = mic.transcribe(new Float32Array([2]), { taskId: 'two', prompt: 'shared context' });
  await tick();
  worker.completeNext('two');
  await second;
  assert.equal(worker.messages.filter(message => message.type === 'setPrompt').length, 1);
  await mic.release();
});

test('worker crash rejects active and queued work with a recognizable error', async () => {
  const worker = new FakeWorker();
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const mic = pool.acquire(config(), 'mic');
  const system = pool.acquire(config(), 'system');
  await tick();
  const active = mic.transcribe(new Float32Array([1]), { taskId: 'mic-1' });
  const queued = system.transcribe(new Float32Array([2]), { taskId: 'system-1' });
  await tick();
  worker.emit('error', new Error('native crash'));
  for (const task of [active, queued]) {
    await assert.rejects(task, error => error instanceof LocalSttWorkerError && error.code === 'worker_crashed');
  }
  await Promise.all([mic.release(), system.release()]);
});

test('worker-compatible lease emits a crash once instead of duplicating it as a task error', async () => {
  const worker = new FakeWorker();
  const pool = new LocalSttWorkerPool({ workerFactory: () => worker });
  const lease = pool.acquire(config(), 'mic');
  const errors = [];
  const messageErrors = [];
  lease.on('error', error => errors.push(error));
  lease.on('message', message => {
    if (message.type === 'error') messageErrors.push(message);
  });
  await tick();
  lease.postMessage({ type: 'transcribe', taskId: 'compat-1', audio: new Float32Array([1]) });
  await tick();
  worker.emit('error', new Error('native crash'));
  await tick();
  assert.equal(errors.length, 1);
  assert.equal(messageErrors.length, 0);
  await lease.release();
});

test('Whisper preloader releases its pooled lease when warmup crashes', () => {
  const source = fs.readFileSync(path.join(root, 'electron/audio/whisper/modelPreloader.ts'), 'utf8');
  const errorHandler = source.match(/w\.on\('error',[\s\S]*?\n\s*}\);/);
  assert.ok(errorHandler, 'preloader must handle pooled worker errors');
  assert.match(errorHandler[0], /w\.terminate\(\)/);
});
