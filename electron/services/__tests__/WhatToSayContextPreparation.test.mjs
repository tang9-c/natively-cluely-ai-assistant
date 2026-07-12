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
  const { prepareWhatToSayContext } = await loadHelper();
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
  const { prepareWhatToSayContext } = await loadHelper();
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
