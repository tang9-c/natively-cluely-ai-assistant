import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const codeHintPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/CodeHintLLM.js');

async function loadCodeHint() {
  return import(pathToFileURL(codeHintPath).href);
}

function makeHelper(overrides = {}) {
  const calls = [];
  return {
    calls,
    getCapabilities() {
      return overrides.capabilities ?? { supportsImages: true, name: 'vision-model' };
    },
    getPromptTier() {
      return 'standard';
    },
    fitContextForCurrentModel(message) {
      return message;
    },
    getCurrentProvider() {
      return 'gemini';
    },
    async *streamChat(message, imagePaths) {
      calls.push({ message, imagePaths });
      if (overrides.throwStream) throw new Error('stream failed with secret code');
      yield 'hint from llm';
    },
  };
}

test('blocks screenshot-derived context when screenshots scope is denied', async () => {
  const { CodeHintLLM } = await loadCodeHint();
  const helper = makeHelper();
  const traces = [];
  const llm = new CodeHintLLM(helper);

  const chunks = [];
  for await (const chunk of llm.generateStream(
    ['/tmp/screenshot.png'],
    'secret screenshot problem statement',
    'screenshot',
    undefined,
    {
      providerScopePolicy: { screenshots: false },
      traceSink: trace => traces.push(trace),
    }
  )) {
    chunks.push(chunk);
  }

  assert.equal(helper.calls.length, 0);
  assert.match(chunks.join(''), /scope|screen|screenshot/i);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].status, 'blocked');
  assert.deepEqual(traces[0].dataScopesRequested, ['screenshots']);
  assert.deepEqual(traces[0].dataScopesDenied, ['screenshots']);
  assert.ok(traces[0].degradedReasons.includes('screen_context_scope_blocked'));
  assert.doesNotMatch(JSON.stringify(traces), /secret screenshot problem statement|screenshot\.png/);
});

test('removes transcript context when transcript scope is denied but still uses allowed screenshot', async () => {
  const { CodeHintLLM } = await loadCodeHint();
  const helper = makeHelper();
  const traces = [];
  const llm = new CodeHintLLM(helper);

  const chunks = [];
  for await (const chunk of llm.generateStream(
    ['/tmp/screenshot.png'],
    undefined,
    null,
    'secret transcript context',
    {
      providerScopePolicy: { transcript: false },
      traceSink: trace => traces.push(trace),
    }
  )) {
    chunks.push(chunk);
  }

  assert.equal(chunks.join(''), 'hint from llm');
  assert.equal(helper.calls.length, 1);
  assert.deepEqual(helper.calls[0].imagePaths, ['/tmp/screenshot.png']);
  assert.doesNotMatch(helper.calls[0].message, /secret transcript context/);
  assert.equal(traces.at(-1).status, 'generated_with_fallback');
  assert.ok(traces.at(-1).degradedReasons.includes('context_scope_denied'));
  assert.doesNotMatch(JSON.stringify(traces), /secret transcript context|screenshot\.png/);
});

test('blocks explicit screenshot request when screenshots scope is denied even after image paths are stripped', async () => {
  const { CodeHintLLM } = await loadCodeHint();
  const helper = makeHelper();
  const traces = [];
  const llm = new CodeHintLLM(helper);

  const chunks = [];
  for await (const chunk of llm.generateStream(
    undefined,
    undefined,
    null,
    undefined,
    {
      providerScopePolicy: { screenshots: false },
      requestedDataScopes: ['screenshots'],
      traceSink: trace => traces.push(trace),
    }
  )) {
    chunks.push(chunk);
  }

  assert.equal(helper.calls.length, 0);
  assert.match(chunks.join(''), /scope|screen|screenshot/i);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].status, 'blocked');
  assert.deepEqual(traces[0].dataScopesRequested, ['screenshots']);
  assert.deepEqual(traces[0].dataScopesDenied, ['screenshots']);
  assert.ok(traces[0].degradedReasons.includes('screen_context_scope_blocked'));
});

test('emits failed trace when streamChat throws', async () => {
  const { CodeHintLLM } = await loadCodeHint();
  const helper = makeHelper({ throwStream: true });
  const traces = [];
  const llm = new CodeHintLLM(helper);
  const logged = [];
  const originalError = console.error;
  console.error = (...args) => {
    logged.push(args.map(String).join(' '));
  };

  const chunks = [];
  try {
    for await (const chunk of llm.generateStream(
      ['/tmp/screenshot.png'],
      undefined,
      null,
      undefined,
      { traceSink: trace => traces.push(trace) }
    )) {
      chunks.push(chunk);
    }
  } finally {
    console.error = originalError;
  }

  assert.match(chunks.join(''), /couldn't analyze|try again/i);
  assert.equal(traces.at(-1).status, 'failed');
  assert.ok(traces.at(-1).degradedReasons.includes('screen_context_failed'));
  assert.doesNotMatch(JSON.stringify(traces), /secret code|screenshot\.png/);
  assert.doesNotMatch(logged.join('\n'), /secret code/);
});

test('trace sink failures do not break code hint generation', async () => {
  const { CodeHintLLM } = await loadCodeHint();
  const helper = makeHelper();
  const llm = new CodeHintLLM(helper);

  const chunks = [];
  for await (const chunk of llm.generateStream(
    ['/tmp/screenshot.png'],
    undefined,
    null,
    undefined,
    {
      traceSink: () => {
        throw new Error('diagnostics down');
      },
    }
  )) {
    chunks.push(chunk);
  }

  assert.equal(chunks.join(''), 'hint from llm');
});
