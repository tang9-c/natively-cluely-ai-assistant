import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const modulePath = path.resolve(root, 'dist-electron/electron/services/context/WhatToSayContextPreparation.js');

async function loadHelper() {
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function decision(overrides = {}) {
  return {
    material: 'not_needed',
    business: 'not_needed',
    screen: 'not_needed',
    confidence: 0.92,
    reason: 'test decision',
    decidedBy: 'dynamic_action_contract',
    ...overrides,
  };
}

function baseInput(overrides = {}) {
  const calls = {
    waitForReady: 0,
    materialFactory: 0,
    materialSearch: 0,
    businessFactory: 0,
    businessResolve: 0,
    screenFactory: 0,
    screenUnderstand: 0,
  };

  return {
    input: {
      question: 'How should I answer?',
      imagePaths: [],
      source: 'dynamic_action',
      modeEvent: {
        productContract: {
          outputType: 'spoken_response',
          contextNeedDecision: decision(),
        },
      },
      providerScopes: {},
      ragManager: {
        isReady: () => true,
        getEmbeddingPipeline: () => ({
          isReady: () => false,
          waitForReady: async () => {
            calls.waitForReady += 1;
          },
        }),
      },
      materialServiceFactory: () => {
        calls.materialFactory += 1;
        return {
          async searchWithDiagnostics() {
            calls.materialSearch += 1;
            return { hits: [] };
          },
        };
      },
      businessSystemServiceFactory: () => {
        calls.businessFactory += 1;
        return {
          async resolve() {
            calls.businessResolve += 1;
            return { kind: 'skipped' };
          },
        };
      },
      screenUnderstandingServiceFactory: () => {
        calls.screenFactory += 1;
        return {
          async understand() {
            calls.screenUnderstand += 1;
            return { status: 'failed', failureReason: 'should_not_run' };
          },
        };
      },
      now: () => Date.now(),
      ...overrides,
    },
    calls,
  };
}

test('prepareWhatToSayContext fast path skips heavy services and embedding readiness wait', async () => {
  const { prepareWhatToSayContext, WhatToSayContextPreparationService } = await loadHelper();
  WhatToSayContextPreparationService.getInstance()._resetCachesForTest();
  const { input, calls } = baseInput();

  const result = await prepareWhatToSayContext(input);

  assert.equal(result.fastPath, true);
  assert.equal(result.contextNeedDecision.material, 'not_needed');
  assert.equal(result.materialRagAttempted, false);
  assert.equal(result.businessSystemResult.kind, 'skipped');
  assert.equal(result.screenContextStatus, 'not_available');
  assert.equal(calls.waitForReady, 0);
  assert.equal(calls.materialFactory, 0);
  assert.equal(calls.materialSearch, 0);
  assert.equal(calls.businessFactory, 0);
  assert.equal(calls.businessResolve, 0);
  assert.equal(calls.screenFactory, 0);
  assert.equal(calls.screenUnderstand, 0);
  assert.ok(result.timings.totalPrepMs < 100, `expected fast prep under 100ms, got ${result.timings.totalPrepMs}ms`);
});

test('prepareWhatToSayContext required material path searches and preserves citations', async () => {
  const { prepareWhatToSayContext, WhatToSayContextPreparationService } = await loadHelper();
  WhatToSayContextPreparationService.getInstance()._resetCachesForTest();
  const { input, calls } = baseInput({
    question: 'Share the ROI proof',
    modeEvent: {
      productContract: {
        outputType: 'spoken_response',
        contextNeedDecision: decision({ material: 'required' }),
      },
    },
    materialServiceFactory: () => {
      calls.materialFactory += 1;
      return {
        async searchWithDiagnostics(query, options) {
          calls.materialSearch += 1;
          return {
            hits: [{
              sourceType: 'uploaded_material',
              sourceId: 'mat-1',
              chunkId: 7,
              score: 0.91,
              title: 'ROI proof',
              text: 'Customer ROI improved after rollout.',
              parentText: 'Customer ROI improved after rollout.',
              fileHash: 'hash-1',
              materialUpdatedAt: '2026-07-01T00:00:00Z',
            }],
            options,
            query,
          };
        },
      };
    },
  });

  const result = await prepareWhatToSayContext(input);

  assert.equal(result.fastPath, false);
  assert.equal(calls.materialFactory, 1);
  assert.equal(calls.materialSearch, 1);
  assert.equal(result.materialRagAttempted, true);
  assert.equal(result.uploadedMaterialHitCount, 1);
  assert.equal(result.citations.length, 1);
  assert.match(result.uploadedMaterialContext ?? '', /uploaded_material_context/);
  assert.equal(calls.businessResolve, 0);
});

test('_resetCachesForTest clears cached material contributions between runs', async () => {
  const { prepareWhatToSayContext, WhatToSayContextPreparationService } = await loadHelper();
  const service = WhatToSayContextPreparationService.getInstance();
  service._resetCachesForTest();
  const { input, calls } = baseInput({
    question: 'Share the ROI proof',
    modeEvent: {
      productContract: {
        outputType: 'spoken_response',
        contextNeedDecision: decision({ material: 'required' }),
      },
    },
  });

  await prepareWhatToSayContext(input);
  await prepareWhatToSayContext(input);
  assert.equal(calls.materialSearch, 1, 'same instance should cache identical material lookup');

  service._resetCachesForTest();
  await prepareWhatToSayContext(input);
  assert.equal(calls.materialSearch, 2, 'resetForTest should clear cached material lookup');
});

test('material cache is scoped by dynamic action identity', async () => {
  const { prepareWhatToSayContext, WhatToSayContextPreparationService } = await loadHelper();
  const service = WhatToSayContextPreparationService.getInstance();
  service._resetCachesForTest();
  const { input, calls } = baseInput({
    question: 'Share the customer material',
    modeEvent: {
      actionId: 'case-study-action',
      productContract: {
        outputType: 'spoken_response',
        contextNeedDecision: decision({ material: 'required' }),
      },
    },
  });

  await prepareWhatToSayContext(input);
  await prepareWhatToSayContext({
    ...input,
    modeEvent: {
      ...input.modeEvent,
      actionId: 'pricing-action',
    },
  });

  assert.equal(calls.materialSearch, 2, 'different dynamic action ids must not share material cache entries');
});

test('context preparation failures are logged with redaction', async () => {
  const { prepareWhatToSayContext, WhatToSayContextPreparationService } = await loadHelper();
  WhatToSayContextPreparationService.getInstance()._resetCachesForTest();
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.map((arg) => String(arg)).join(' '));
  };
  try {
    const { input } = baseInput({
      modeEvent: {
        productContract: {
          outputType: 'spoken_response',
          contextNeedDecision: decision({ business: 'required' }),
        },
      },
      businessSystemServiceFactory: () => ({
        async resolve() {
          const error = new Error('business lookup failed');
          error.apiKey = 'sk-test-secret-12345678901234567890';
          error.prompt = 'raw customer transcript should not appear';
          throw error;
        },
      }),
    });

    const result = await prepareWhatToSayContext(input);

    assert.equal(result.businessSystemResult.kind, 'fixed_reply');
    const joined = warnings.join('\n');
    assert.match(joined, /business_context/);
    assert.match(joined, /business lookup failed/);
    assert.doesNotMatch(joined, /sk-test-secret/);
    assert.doesNotMatch(joined, /raw customer transcript/);
  } finally {
    console.warn = originalWarn;
  }
});

test('dynamic business action resolves original query from latestTurn instead of prompt instruction or retrievalQuery', async () => {
  const { prepareWhatToSayContext, WhatToSayContextPreparationService } = await loadHelper();
  WhatToSayContextPreparationService.getInstance()._resetCachesForTest();
  const calls = [];
  const { input } = baseInput({
    question: undefined,
    source: 'dynamic_action',
    modeEvent: {
      actionType: 'business_system_query',
      latestTurn: '查一下 PLM 里 golf car 的 BOM 发布了没有',
      retrievalQuery: 'fde business entities golf car BOM',
      productContract: {
        outputType: 'spoken_response',
        contextNeedDecision: decision({ business: 'required' }),
      },
    },
    promptInstruction: '帮我回答客户这个问题',
    businessSystemServiceFactory: () => ({
      async resolve(request) {
        calls.push(request);
        return { kind: 'fixed_reply', status: 'no_result', answer: '未查到匹配结果' };
      },
    }),
  });

  await prepareWhatToSayContext(input);
  await prepareWhatToSayContext(input);

  assert.equal(calls.length, 1, 'same resolved business query should use the same cache key');
  assert.equal(calls[0].question, '查一下 PLM 里 golf car 的 BOM 发布了没有');
  assert.notEqual(calls[0].question, input.promptInstruction);
  assert.notEqual(calls[0].question, input.modeEvent.retrievalQuery);
});
