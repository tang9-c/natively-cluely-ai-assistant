import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const distWhatToAnswerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js');

function createHelper(overrides = {}) {
  const calls = [];
  return {
    calls,
    getCapabilities: () => ({ outputBudgetTokens: 2000, maxContextTokens: 8192, supportsImages: true }),
    getPromptTier: () => 'full',
    getCurrentProvider: () => 'openai',
    getCurrentModel: () => 'gpt-test',
    isLocalOnly: () => false,
    canUseLocalFallback: async () => false,
    fitContextForCurrentModel: (text) => text,
    async *streamChat(...args) {
      calls.push(args);
      yield 'ok';
    },
    ...overrides,
  };
}

test('reference_files scope denial omits uploaded material from cloud prompt', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const helper = createHelper();
  const traces = [];
  const answerer = new WhatToAnswerLLM(helper, {
    getActiveModeSystemPromptSuffix: () => 'mode suffix',
    buildRetrievedActiveModeContextBlock: () => '<reference_file>MODE_SECRET</reference_file>',
  });

  const chunks = [];
  for await (const chunk of answerer.generateStream(
    'Customer asks about SOC2.',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    '<uploaded_material_context>UPLOADED_SECRET</uploaded_material_context>',
    undefined,
    undefined,
    [],
    (trace) => traces.push(trace),
    { reference_files: false },
  )) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ['ok']);
  assert.equal(helper.calls.length, 1);
  assert.doesNotMatch(helper.calls[0][0], /UPLOADED_SECRET|MODE_SECRET/);
  assert.ok(traces[0].degradedReasons.includes('context_scope_denied'));
  assert.equal(traces[0].contextUsed.uploadedDocumentRag, false);
});
