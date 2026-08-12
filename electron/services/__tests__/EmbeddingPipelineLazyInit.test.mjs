import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const { EmbeddingPipeline } = require(path.join(root, 'dist-electron/electron/rag/EmbeddingPipeline.js'));

test('configure is lazy and concurrent first embedding requests share initialization', async () => {
  const pipeline = new EmbeddingPipeline({}, {});
  let initializeCalls = 0;
  let releaseInitialization;
  const initializationGate = new Promise(resolve => { releaseInitialization = resolve; });
  const provider = {
    name: 'test',
    dimensions: 2,
    space: 'test:model:2',
    embedBatch: async texts => texts.map(() => [1, 2]),
    embed: async () => [1, 2],
    embedQuery: async () => [1, 2],
  };

  pipeline._doInitialize = async function () {
    initializeCalls += 1;
    await initializationGate;
    this.provider = provider;
  };

  pipeline.configure({});
  assert.equal(initializeCalls, 0, 'configuration must not load the model');

  const first = pipeline.getEmbeddings(['one']);
  const second = pipeline.getEmbeddingForQuery('two');
  assert.equal(initializeCalls, 1, 'first concurrent consumers must share one initialization');
  releaseInitialization();
  assert.deepEqual(await first, [[1, 2]]);
  assert.deepEqual(await second, [1, 2]);
  assert.equal(initializeCalls, 1);
});

test('failed lazy initialization can be retried with the same configuration', async () => {
  const pipeline = new EmbeddingPipeline({}, {});
  let calls = 0;
  pipeline._doInitialize = async function () {
    calls += 1;
    if (calls === 1) throw new Error('temporary failure');
    this.provider = { name: 'recovered', dimensions: 1, space: 'recovered:1' };
  };
  pipeline.configure({});
  await assert.rejects(() => pipeline.ensureInitialized(), /temporary failure/);
  await pipeline.ensureInitialized();
  assert.equal(calls, 2);
  assert.equal(pipeline.isReady(), true);
});

test('configuration updated during initialization is applied before initialization completes', async () => {
  const pipeline = new EmbeddingPipeline({}, {});
  const seenKeys = [];
  let releaseFirst;
  const firstGate = new Promise(resolve => { releaseFirst = resolve; });
  pipeline._doInitialize = async function (config) {
    seenKeys.push(config.openaiKey);
    if (seenKeys.length === 1) await firstGate;
    this.provider = { name: 'test', dimensions: 1, space: 'test:1' };
  };
  pipeline.configure({ openaiKey: 'old' });
  const initializing = pipeline.ensureInitialized();
  pipeline.configure({ openaiKey: 'new' });
  releaseFirst();
  await initializing;
  assert.deepEqual(seenKeys, ['old', 'new']);
});

test('concurrent queue processing is locked before lazy initialization awaits', async () => {
  let releaseInitialization;
  const gate = new Promise(resolve => { releaseInitialization = resolve; });
  let ensureCalls = 0;
  let recoveryCalls = 0;
  const db = {
    prepare(sql) {
      if (sql.includes("status = 'pending' WHERE status = 'processing'")) {
        return { run: () => { recoveryCalls += 1; return { changes: 0 }; } };
      }
      if (sql.includes('SELECT * FROM embedding_queue')) return { get: () => undefined };
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const pipeline = new EmbeddingPipeline(db, {});
  pipeline.ensureInitialized = async () => {
    ensureCalls += 1;
    await gate;
  };
  const first = pipeline.processQueue();
  const second = pipeline.processQueue();
  releaseInitialization();
  await Promise.all([first, second]);
  assert.equal(ensureCalls, 1);
  assert.equal(recoveryCalls, 1);
});

test('RAGManager constructor configures embeddings without initializing them', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'electron/rag/RAGManager.ts'), 'utf8');
  const constructorBody = source.slice(source.indexOf('constructor(config:'), source.indexOf('setLLMHelper('));
  assert.match(constructorBody, /embeddingPipeline\.configure\(/);
  assert.doesNotMatch(constructorBody, /embeddingPipeline\.initialize\(/);
});

test('startup credential loading does not immediately process embeddings', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'electron/ProcessingHelper.ts'), 'utf8');
  assert.doesNotMatch(source, /retryPendingEmbeddings\(\)/);
  assert.doesNotMatch(source, /ensureDemoMeetingProcessed\(\)/);
});

test('first material and live-meeting indexing trigger lazy initialization instead of skipping', () => {
  const fs = require('node:fs');
  const materialSource = fs.readFileSync(path.join(root, 'electron/services/knowledge/KnowledgeMaterialService.ts'), 'utf8');
  const ragSource = fs.readFileSync(path.join(root, 'electron/rag/RAGManager.ts'), 'utf8');
  assert.doesNotMatch(materialSource, /embeddingPipeline\?\.isReady\(\)\s*&&/);
  assert.match(ragSource, /await this\.embeddingPipeline\.ensureInitialized\(\)/);
});

test('health checks do not initiate embedding while real material retrieval does', () => {
  const source = require('node:fs').readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
  const readinessHelper = source.slice(source.indexOf('async function waitForEmbeddingReadiness'), source.indexOf('async function getRagReadiness'));
  assert.match(readinessHelper, /isInitializing/);
  const materialResolver = source.slice(source.indexOf('const resolveUploadedMaterialChatContext'), source.indexOf('// --- Test Helper'));
  assert.match(materialResolver, /ensureInitialized/);
});
