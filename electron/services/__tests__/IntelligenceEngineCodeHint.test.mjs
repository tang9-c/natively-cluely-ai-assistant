import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
  };
}

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  return { engine, session };
}

test('runCodeHint returns stream on supersession and does not emit stale final result', async () => {
  const { engine, session } = await makeEngine();
  let returned = false;

  engine.codeHintLLM = {
    generateStream() {
      return {
        async *[Symbol.asyncIterator]() {
          yield 'partial hint';
          engine.currentGenerationId += 1;
          yield 'stale hint';
        },
        async return() {
          returned = true;
          return { done: true };
        },
      };
    },
  };

  const tokens = [];
  const finals = [];
  engine.on('suggested_answer_token', token => tokens.push(token));
  engine.on('suggested_answer', answer => finals.push(answer));

  const result = await engine.runCodeHint(['screenshot.png'], 'fix this code');

  assert.equal(result, null);
  assert.equal(returned, true);
  assert.deepEqual(tokens, ['partial hint']);
  assert.deepEqual(finals, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('partial hint')), false);
});

test('runCodeHint passes provider scope policy and emits redacted code hint trace', async () => {
  const { engine } = await makeEngine();
  const traces = [];
  let receivedOptions = null;

  engine.on('code_hint_trace', trace => traces.push(trace));
  engine.codeHintLLM = {
    async *generateStream(_imagePaths, _questionContext, _questionSource, _transcriptContext, options) {
      receivedOptions = options;
      options.traceSink({
        entrypoint: 'code_hint',
        status: 'blocked',
        dataScopesRequested: ['screenshots'],
        dataScopesDenied: ['screenshots'],
        usedContextSources: [],
        sourceStatus: { screenContextStatus: 'blocked', transcriptStatus: 'not_used' },
        degradedReasons: ['screen_context_scope_blocked'],
        usedVision: false,
        usedTranscript: false,
        provider: 'gemini',
      });
      yield 'blocked by scope';
    },
  };

  const result = await engine.runCodeHint(['screenshot.png'], 'secret problem');

  assert.equal(result, 'blocked by scope');
  assert.ok(receivedOptions);
  assert.equal(typeof receivedOptions.traceSink, 'function');
  assert.ok(traces.length >= 1);
  assert.equal(traces[0].entrypoint, 'code_hint');
  assert.doesNotMatch(JSON.stringify(traces), /secret problem|screenshot\.png/);
});

test('runCodeHint forwards explicit requested data scopes to CodeHintLLM', async () => {
  const { engine } = await makeEngine();
  let receivedOptions = null;

  engine.codeHintLLM = {
    async *generateStream(_imagePaths, _questionContext, _questionSource, _transcriptContext, options) {
      receivedOptions = options;
      yield 'blocked by scope';
    },
  };

  const result = await engine.runCodeHint(undefined, undefined, { requestedDataScopes: ['screenshots'] });

  assert.equal(result, 'blocked by scope');
  assert.deepEqual(receivedOptions.requestedDataScopes, ['screenshots']);
});

test('runCodeHint signature accepts requestedDataScopes option', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
  const start = source.indexOf('async runCodeHint(');
  const end = source.indexOf('\n    /**\n     * MODE 8:', start);
  const body = source.slice(start, end);

  assert.match(body, /requestedDataScopes/);
});

test('runCodeHint reads providerDataScopes before calling CodeHintLLM', () => {
  const fs = require('fs');
  const source = fs.readFileSync(path.resolve(__dirname, '../../IntelligenceEngine.ts'), 'utf8');
  const start = source.indexOf('async runCodeHint(');
  const end = source.indexOf('\n    /**\n     * MODE 8:', start);
  const body = source.slice(start, end);

  assert.match(body, /SettingsManager\.getInstance\(\)\.get\('providerDataScopes'\)/);
  assert.match(body, /providerScopePolicy/);
  assert.match(body, /traceSink/);
});
