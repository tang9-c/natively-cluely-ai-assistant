import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const distWhatToAnswerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/WhatToAnswerLLM.js');

function createHelper(overrides = {}) {
  return {
    getCapabilities: () => ({ outputBudgetTokens: 2000, maxContextTokens: 8192, supportsImages: true }),
    getPromptTier: () => 'full',
    getCurrentProvider: () => 'test-provider',
    getCurrentModel: () => 'test-model',
    isLocalOnly: () => false,
    fitContextForCurrentModel: text => text,
    async *streamChat() {
      yield 'ok';
    },
    ...overrides,
  };
}

test('WhatToAnswerLLM traceSink emits context metadata before streaming', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const traces = [];
  const answerer = new WhatToAnswerLLM(createHelper(), {
    getActiveModeSystemPromptSuffix: () => 'mode suffix',
    buildRetrievedActiveModeContextBlock: () => '<reference_file>pricing policy</reference_file>',
  });

  const chunks = [];
  for await (const chunk of answerer.generateStream(
    'Customer asks for a discount.',
    { hasRecentResponses: true, previousResponses: ['Prior answer'] },
    undefined,
    undefined,
    undefined,
    undefined,
    '<reference_file name="pricing.md">No discount without manager approval.</reference_file>',
    undefined,
    undefined,
    [],
    trace => traces.push(trace),
  )) {
    chunks.push(chunk);
  }

  assert.deepEqual(chunks, ['ok']);
  assert.equal(traces.length, 1);
  assert.equal(traces[0].contextUsed.currentTranscript, true);
  assert.equal(traces[0].contextUsed.shortTermHistory, true);
  assert.equal(traces[0].contextUsed.uploadedDocumentRag, true);
  assert.equal(traces[0].sourceStatus.citationCount, 0);
});

test('WhatToAnswerLLM traceSink emits minimal trace for unsupported image early return', async () => {
  const { WhatToAnswerLLM } = require(distWhatToAnswerPath);
  const traces = [];
  const answerer = new WhatToAnswerLLM(createHelper({
    getCapabilities: () => ({ supportsImages: false, outputBudgetTokens: 2000, maxContextTokens: 8192 }),
  }));

  const chunks = [];
  for await (const chunk of answerer.generateStream(
    'What should I say about this screen?',
    undefined,
    undefined,
    ['/tmp/screen.png'],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    trace => traces.push(trace),
  )) {
    chunks.push(chunk);
  }

  assert.equal(traces.length, 1);
  assert.equal(traces[0].contextUsed.screenContext, false);
  assert.equal(traces[0].sourceStatus.screenContextStatus, 'failed');
  assert.ok(traces[0].degradedReasons.includes('screen_context_no_vision_provider'));
  assert.match(chunks.join(''), /does not support image input|cannot send screenshots/i);
});
