// electron/llm/__tests__/WhatToAnswerLLM.test.mjs
//
// Phase 4 PR4.3 — coverage for WhatToAnswerLLM (currently 29.45%).
// Focus areas:
//   - constructor injection of ModesManager (avoids SettingsManager.getInstance()
//     footgun documented in the source comment).
//   - generate() (deprecated non-streaming path) buffers the entire stream.
//   - generateStream() with attached image but no vision capability → early
//     return with localized fallback message + degraded trace.
//   - generateStream() in local-only mode with attached image → privacy-prefixed
//     fallback message instead of the generic "does not support image input".
//   - generateStream() with intentResult and modeEvent populates the
//     intent_context block with intent + answerShape + language + entities.
//   - generateStream() with activeSkill completely replaces the mode suffix and
//     mode-context block (skill promptBlock is trusted; reference docs are
//     skipped).
//   - generateStream() with buildRetrievedActiveModeContextBlockHybrid returns
//     a non-empty block (uses the async hybrid path).
//   - generateStream() error path yields a friendly fallback message instead
//     of throwing to the caller.
//   - buildTraceMetadata() shapes are populated correctly via the traceSink.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const distPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/llm/WhatToAnswerLLM.js',
);

function createHelper(overrides = {}) {
  const calls = [];
  return {
    calls,
    getCapabilities: () => ({
      outputBudgetTokens: 2000,
      maxContextTokens: 8192,
      supportsImages: true,
    }),
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

function createModesManager(overrides = {}) {
  return {
    getActiveModeSystemPromptSuffix: () => 'MODE_SUFFIX',
    buildActiveModeContextBlock: () => '',
    buildRetrievedActiveModeContextBlock: () => '',
    ...overrides,
  };
}

test('WhatToAnswerLLM.generate() (deprecated) buffers the entire stream into one string', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper({
    async *streamChat() {
      yield 'Hello';
      yield ', ';
      yield 'world!';
    },
  });
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  const full = await answerer.generate('what is the next step?');
  assert.equal(full, 'Hello, world!');
});

test('generateStream() emits vision-capability fallback when attached images exceed provider capability', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper({
    getCapabilities: () => ({
      outputBudgetTokens: 2000,
      maxContextTokens: 8192,
      supportsImages: false,
    }),
  });
  const traces = [];
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  const chunks = [];
  for await (const chunk of answerer.generateStream(
    'screen says TypeError',
    undefined,
    undefined,
    ['/tmp/screen.png'],
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    (trace) => traces.push(trace),
  )) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /does not support image input/);
  assert.equal(traces[0].sourceStatus.screenContextStatus, 'failed');
  assert.ok(traces[0].degradedReasons.includes('screen_context_no_vision_provider'));
});

test('generateStream() in local-only mode uses privacy-prefixed vision fallback message', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper({
    getCapabilities: () => ({
      outputBudgetTokens: 2000,
      maxContextTokens: 8192,
      supportsImages: false,
    }),
    isLocalOnly: () => true,
  });
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  const chunks = [];
  for await (const chunk of answerer.generateStream(
    'screen prompt',
    undefined,
    undefined,
    ['/tmp/screen.png'],
  )) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /Local-only mode is enabled/);
  assert.match(chunks[0], /cannot send screenshots to a cloud vision model/);
});

test('generateStream() includes intent + answerShape + language in the assembled prompt when intentResult is provided', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper();
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  for await (const _ of answerer.generateStream(
    'Can you draft a pricing proposal for Acme?',
    undefined,
    { intent: 'pricing_proposal', confidence: 0.9, answerShape: 'concise_business' },
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      modeTemplateType: 'sales',
      language: 'zh',
      latestTurn: '你能帮我给 Acme 起草一个报价吗',
      keyEntities: ['Acme'],
    },
  )) {
    // drain
  }

  assert.equal(helper.calls.length, 1);
  const userPrompt = helper.calls[0][0];
  assert.match(userPrompt, /DETECTED INTENT: pricing_proposal/);
  assert.match(userPrompt, /ANSWER SHAPE: concise_business/);
  assert.match(userPrompt, /modeTemplateType: sales/);
  assert.match(userPrompt, /key_entities/);
  assert.match(userPrompt, /Acme/);
  assert.match(userPrompt, /Detected meeting language: zh/);
});

test('generateStream() substitutes activeSkill promptBlock for the mode suffix and skips mode-context retrieval', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper();
  let buildRetrievedCalled = false;
  const SECRET_TOKEN = 'XMODESHOULDNOTAPPEARX';
  const modesManager = createModesManager({
    buildRetrievedActiveModeContextBlock: () => {
      buildRetrievedCalled = true;
      return `<reference>${SECRET_TOKEN}</reference>`;
    },
  });
  const answerer = new WhatToAnswerLLM(helper, modesManager);

  for await (const _ of answerer.generateStream(
    'help me with a custom workflow',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    {
      id: 'skill-1',
      name: 'Custom Skill',
      promptBlock: 'CUSTOM_SKILL_BLOCK_HERE',
    },
  )) {
    // drain
  }

  assert.equal(buildRetrievedCalled, false, 'skill mode must skip mode-context retrieval');
  const systemPrompt = helper.calls[0][3];
  const chatPromptOptions = helper.calls[0][7];
  assert.equal(chatPromptOptions.qcloudModel, 'turbo');
  assert.deepEqual(chatPromptOptions.qcloudThinking, { type: 'enabled' });
  assert.equal(chatPromptOptions.qcloudReasoningEffort, 'medium');
  assert.equal(chatPromptOptions.totalTimeoutMs, 60_000);
  assert.match(systemPrompt, /CUSTOM_SKILL_BLOCK_HERE/);
  assert.doesNotMatch(systemPrompt, /## ACTIVE MODE\nMODE_SUFFIX/);
  assert.doesNotMatch(systemPrompt, new RegExp(SECRET_TOKEN));
  // user message must also not contain the secret token
  const userPrompt = helper.calls[0][0];
  assert.doesNotMatch(userPrompt, new RegExp(SECRET_TOKEN));
});

test('generateStream() prefers async hybrid mode-context retrieval over the sync lexical fallback', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper();
  const modesManager = createModesManager({
    buildRetrievedActiveModeContextBlockHybrid: async () =>
      '<active_mode_retrieved_context>hybrid answer here</active_mode_retrieved_context>',
    buildRetrievedActiveModeContextBlock: () => 'lexical only — should not be used',
  });
  const answerer = new WhatToAnswerLLM(helper, modesManager);

  for await (const _ of answerer.generateStream(
    'What does our pricing policy say about enterprise deals?',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { modeTemplateType: 'sales' },
  )) {
    // drain
  }

  const userPrompt = helper.calls[0][0];
  assert.match(userPrompt, /hybrid answer here/);
  assert.doesNotMatch(userPrompt, /lexical only/);
});

test('generateStream() marks transcript_truncated when fitContextForCurrentModel shrinks the input', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper({
    fitContextForCurrentModel: (text) => text.slice(0, 5),
  });
  const traces = [];
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  for await (const _ of answerer.generateStream(
    'a very long transcript that will be truncated by fitContextForCurrentModel',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    (trace) => traces.push(trace),
  )) {
    // drain
  }

  assert.ok(traces.length >= 1);
  assert.ok(
    traces[0].degradedReasons.includes('transcript_truncated'),
    'expected transcript_truncated in degraded reasons',
  );
});

test('generateStream() emits a friendly fallback message when the helper throws', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper({
    async *streamChat() {
      throw new Error('boom: stream failed');
    },
  });
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  const chunks = [];
  for await (const chunk of answerer.generateStream('how should we close?')) {
    chunks.push(chunk);
  }

  assert.equal(chunks.length, 1);
  assert.match(chunks[0], /Could you repeat that/);
});

test('generateStream() propagates an explicit QCLOUD failure before the first token', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper({
    async *streamChat() {
      throw new Error('QCLOUD API first token timeout');
    },
  });
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  await assert.rejects(
    async () => {
      for await (const _ of answerer.generateStream('how should we close?')) {
        // drain
      }
    },
    /QCLOUD API first token timeout/,
  );
});

test('generateStream() propagates any error after yielding a partial answer', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper({
    async *streamChat() {
      yield 'partial answer';
      throw new Error('connection reset');
    },
  });
  const answerer = new WhatToAnswerLLM(helper, createModesManager());
  const chunks = [];

  await assert.rejects(
    async () => {
      for await (const chunk of answerer.generateStream('how should we close?')) {
        chunks.push(chunk);
      }
    },
    /connection reset/,
  );
  assert.deepEqual(chunks, ['partial answer']);
});

test('generateStream() does not override provider output token budgets', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  async function captureBudget(args = []) {
    let capturedOptions;
    const helper = createHelper({
      async *streamChat(_message, _images, _context, _system, _includeHistory, _skipModeInjection, _scopes, options) {
        capturedOptions = options;
        yield 'answer';
      },
    });
    const answerer = new WhatToAnswerLLM(helper, createModesManager());
    for await (const _ of answerer.generateStream(...args)) {
      // drain
    }
    return capturedOptions;
  }

  assert.equal(await captureBudget(['how should we answer?']), undefined);
  assert.equal(await captureBudget(['answer the objection', undefined, undefined, undefined, undefined, 'draft a short sales card']), undefined);
  assert.equal(await captureBudget([
    'how should we answer the PLM risk?',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { modeTemplateType: 'fde', intent: 'integration_risk' },
  ]), undefined);
  assert.equal(await captureBudget([
    'what should I say about this error?',
    undefined,
    undefined,
    ['/tmp/screen.png'],
  ]), undefined);
});

test('generateStream() trace metadata reports uploadedDocumentRag when uploadedMaterialContext is non-empty', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper();
  const traces = [];
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  for await (const _ of answerer.generateStream(
    'look up the latest contract',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    '<uploaded_material_context>some contract excerpt</uploaded_material_context>',
    undefined,
    undefined,
    [],
    (trace) => traces.push(trace),
  )) {
    // drain
  }

  assert.equal(traces[0].contextUsed.uploadedDocumentRag, true);
  assert.equal(traces[0].sourceStatus.uploadedMaterialHitCount, 1);
  assert.equal(traces[0].sourceStatus.ragAttempted, true);
});

test('generateStream() passes reference_files scope when providerScopePolicy allows it', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper();
  const answerer = new WhatToAnswerLLM(helper, createModesManager({
    buildRetrievedActiveModeContextBlock: () =>
      '<active_mode_retrieved_context>ref doc excerpt</active_mode_retrieved_context>',
  }));

  for await (const _ of answerer.generateStream(
    'how does the policy apply?',
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    () => {},
    { reference_files: true },
  )) {
    // drain
  }

  // packetScopes is the 7th positional arg (index 6) passed to streamChat.
  const packetScopes = helper.calls[0][6];
  assert.ok(Array.isArray(packetScopes));
  assert.ok(packetScopes.includes('reference_files'));
});

test('generateStream() screenContext availability is reflected in trace metadata', async () => {
  const { WhatToAnswerLLM } = require(distPath);
  const helper = createHelper();
  const traces = [];
  const answerer = new WhatToAnswerLLM(helper, createModesManager());

  const screenContext = {
    timestamp: Date.now(),
    extractedText: 'something on the screen',
    visibleSummary: 'pricing dashboard',
  };

  for await (const _ of answerer.generateStream(
    'summarize the screen',
    undefined,
    undefined,
    undefined,
    screenContext,
    undefined,
    undefined,
    undefined,
    undefined,
    [],
    (trace) => traces.push(trace),
  )) {
    // drain
  }

  assert.equal(traces[0].contextUsed.screenContext, true);
  assert.equal(traces[0].sourceStatus.screenContextStatus, 'available');
});
