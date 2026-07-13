import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import {
  DISCOVERY_INTENTS,
  SALES_INDUSTRIAL_POSITIVE_FIXTURES,
  SALES_INDUSTRIAL_NEGATIVE_FIXTURES,
  SALES_INDUSTRIAL_CONFLICT_FIXTURES,
  NON_SALES_INDUSTRIAL_ISOLATION_FIXTURES,
  SALES_INDUSTRIAL_TIER2_FIXTURES,
} from './SalesIndustrialDiscoveryFixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const modulePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/llm/IntentClassifier.js',
);

function loadClassifier() {
  delete cjsRequire.cache[modulePath];
  return cjsRequire(modulePath);
}

const TIER1_EXPLICIT_NOTES = new Set([
  'PLM pain',
  'PLM capability fit',
  'PLM integration',
  'PLM value',
  'PLM contextual proof',
  'QMS pain',
  'ERP integration',
  'MES pain',
  'ALM pain',
  'Creo pain',
  'fluid simulation capability fit',
  'AI Agent capability fit',
  'AI Agent contextual proof',
]);

describe('sales industrial discovery intent classification', () => {
  test('Tier 1 classifies explicit industrial sales discovery moments locally', async () => {
    const { classifyIntent } = loadClassifier();
    const tier1Rows = SALES_INDUSTRIAL_POSITIVE_FIXTURES.filter((fixture) =>
      TIER1_EXPLICIT_NOTES.has(fixture.notes),
    );

    for (const fixture of tier1Rows) {
      let cloudCalled = false;
      const result = await classifyIntent(fixture.utterance, `[INTERVIEWER]: ${fixture.utterance}`, 0, 'sales', {
        cloudIntentClassifier: async () => {
          cloudCalled = true;
          throw new Error('Tier 1 rows must not need cloud classification');
        },
      });

      assert.equal(result.intent, fixture.expectedIntent, fixture.notes);
      assert.ok(result.confidence >= 0.8, fixture.notes);
      assert.equal(cloudCalled, false, fixture.notes);
    }
  });

  test('Tier 2 candidates include industrial discovery intents for sales mode', async () => {
    const { classifyIntent } = loadClassifier();
    const tier2Rows = SALES_INDUSTRIAL_POSITIVE_FIXTURES.filter((fixture) =>
      !TIER1_EXPLICIT_NOTES.has(fixture.notes),
    );

    for (const fixture of tier2Rows) {
      let cloudCalled = false;
      const result = await classifyIntent(fixture.utterance, `[INTERVIEWER]: ${fixture.utterance}`, 0, 'sales', {
        cloudIntentClassifier: async (input) => {
          cloudCalled = true;
          assert.ok(input.candidateIntents.includes(fixture.expectedIntent), fixture.notes);
          return { intent: fixture.expectedIntent, confidence: 0.82 };
        },
      });

      assert.equal(cloudCalled, true, fixture.notes);
      assert.equal(result.intent, fixture.expectedIntent, fixture.notes);
      assert.equal(result.confidence, 0.82, fixture.notes);
    }
  });

  test('sales cloud candidates prioritize industrial discovery before generic proof and technical intents', async () => {
    const { classifyIntent } = loadClassifier();
    const utterance = '我们想确认流体仿真模块是否适合电池包冷却液流道。';
    let candidateIntents = [];

    await classifyIntent(utterance, `[INTERVIEWER]: ${utterance}`, 0, 'sales', {
      cloudIntentClassifier: async (input) => {
        candidateIntents = input.candidateIntents;
        return { intent: 'sales_capability_fit', confidence: 0.83 };
      },
    });

    assert.deepEqual(candidateIntents.slice(0, 8), [
      'sales_buying_signal',
      'sales_pricing_objection',
      'sales_quote_request',
      'sales_contextual_proof_discovery',
      'sales_capability_fit',
      'sales_process_integration',
      'sales_value_discovery',
      'sales_pain_discovery',
    ]);
    assert.ok(candidateIntents.indexOf('sales_proof_request') > candidateIntents.indexOf('sales_pain_discovery'));
    assert.ok(candidateIntents.indexOf('sales_technical_requirements') > candidateIntents.indexOf('sales_pain_discovery'));
  });

  test('natural Tier 2 industrial sales phrasings are exposed to cloud classifier', async () => {
    const { classifyIntent } = loadClassifier();

    for (const fixture of SALES_INDUSTRIAL_TIER2_FIXTURES) {
      let cloudCalled = false;
      const result = await classifyIntent(fixture.utterance, `[INTERVIEWER]: ${fixture.utterance}`, 0, 'sales', {
        cloudIntentClassifier: async (input) => {
          cloudCalled = true;
          assert.ok(input.candidateIntents.includes(fixture.expectedIntent), fixture.notes);
          return { intent: fixture.expectedIntent, confidence: 0.83 };
        },
      });

      assert.equal(cloudCalled, true, fixture.notes);
      assert.equal(result.intent, fixture.expectedIntent, fixture.notes);
    }
  });

  test('conflict fixtures keep the intended sales semantic intent', async () => {
    const { classifyIntent } = loadClassifier();

    for (const fixture of SALES_INDUSTRIAL_CONFLICT_FIXTURES) {
      const result = await classifyIntent(fixture.utterance, `[INTERVIEWER]: ${fixture.utterance}`, 0, 'sales', {
        cloudIntentClassifier: async (input) => {
          assert.ok(input.candidateIntents.includes(fixture.expectedIntent), fixture.notes);
          return { intent: fixture.expectedIntent, confidence: 0.84 };
        },
      });

      assert.equal(result.intent, fixture.expectedIntent, fixture.notes);
      assert.ok(!fixture.mustNotIntent.includes(result.intent), fixture.notes);
    }
  });

  test('negative sales fixtures do not classify as forbidden discovery intents', async () => {
    const { classifyIntent } = loadClassifier();

    for (const fixture of SALES_INDUSTRIAL_NEGATIVE_FIXTURES) {
      let cloudCalled = false;
      const result = await classifyIntent(fixture.utterance, `[INTERVIEWER]: ${fixture.utterance}`, 0, 'sales', {
        providerDataScopes: { transcript: false },
        cloudIntentClassifier: async () => {
          cloudCalled = true;
          return null;
        },
      });

      assert.equal(cloudCalled, false, fixture.notes);
      assert.ok(!fixture.mustNotIntent.includes(result.intent), fixture.notes);
    }
  });

  test('non-sales modes do not return sales industrial discovery intents', async () => {
    const { classifyIntent } = loadClassifier();

    for (const fixture of NON_SALES_INDUSTRIAL_ISOLATION_FIXTURES) {
      const result = await classifyIntent(fixture.utterance, `[INTERVIEWER]: ${fixture.utterance}`, 0, fixture.modeTemplateType, {
        providerDataScopes: { transcript: false },
      });

      assert.equal(result.intent, fixture.expectedIntent, fixture.notes);
      assert.ok(!DISCOVERY_INTENTS.includes(result.intent), fixture.notes);
    }
  });
});
