// electron/services/research/__tests__/ResearchDossierBuilder.test.mjs
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const builderPath = path.resolve(
  __dirname, '../../../../dist-electron/electron/services/research/ResearchDossierBuilder.js',
);

function makeMockLlm(responses) {
  let callIdx = 0;
  return {
    generateStructured: async (prompt, schema) => {
      const r = responses[callIdx++];
      if (r instanceof Error) throw r;
      return r;
    },
  };
}

describe('ResearchDossierBuilder', () => {
  test('build() with sources marks dossier.source = "tavily"', async () => {
    const validDossier = {
      schemaVersion: '1.0', companyName: 'Apple', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [{ text: 'f' }], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [{ index: 1, title: 't', url: 'https://x', snippet: 's' }],
    };
    const llm = makeMockLlm([validDossier]);
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', [{ title: 't', url: 'https://x', content: 's' }]);
    assert.equal(out.source, 'tavily');
    assert.equal(out.financials.confidence, 'high');
  });

  test('build() accepts provider responses wrapped in markdown JSON fences', async () => {
    const validDossier = {
      schemaVersion: '1.0', companyName: 'IBM',
      financials: { summary: 's', details: [{ text: 'f', citation: 1 }], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [{ index: 1, title: 't', url: 'https://x.example', snippet: 's' }],
    };
    const llm = {
      generateStructured: async () => `\`\`\`json\n${JSON.stringify(validDossier)}\n\`\`\``,
    };

    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('IBM', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.companyName, 'IBM');
    assert.equal(out.financials.details[0].citation, 1);
  });

  test('build() extracts the first complete JSON object from prose-wrapped responses', async () => {
    const validDossier = {
      schemaVersion: '1.0', companyName: 'IBM',
      financials: { summary: 's', details: [{ text: 'uses {braces} in text' }], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = {
      generateStructured: async () => `Here is the dossier:\n${JSON.stringify(validDossier)}\nDone.`,
    };

    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('IBM', []);
    assert.equal(out.companyName, 'IBM');
    assert.equal(out.financials.details[0].text, 'uses {braces} in text');
    assert.equal(out.source, 'llm-fallback');
  });

  test('build() with empty sources marks dossier.source = "llm-fallback"', async () => {
    const llmDossier = {
      schemaVersion: '1.0', companyName: 'Apple', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = makeMockLlm([llmDossier]);
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', []);
    assert.equal(out.source, 'llm-fallback');
  });

  test('build() retries once when LLM returns invalid shape', async () => {
    const validDossier = {
      schemaVersion: '1.0', companyName: 'X', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = {
      generateStructured: async () => {
        if (!llm._called) { llm._called = true; throw new Error('invalid shape'); }
        return validDossier;
      },
    };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('X', []);
    assert.equal(out.companyName, 'X');
  });

  test('build() throws LlmInvalidFormatError after retry exhaustion', async () => {
    const llm = { generateStructured: async () => { throw new Error('still bad'); } };
    const { ResearchDossierBuilder, LlmInvalidFormatError } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    await assert.rejects(() => b.build('X', []), (err) => err instanceof LlmInvalidFormatError);
  });

  test('build() invokes onAttempt before each LLM call (1-based, max 2)', async () => {
    const calls = [];
    let llmCallCount = 0;
    const validDossier = {
      schemaVersion: '1.0', companyName: 'X', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = {
      generateStructured: async () => {
        llmCallCount += 1;
        if (llmCallCount === 1) throw new Error('retry me');
        return validDossier;
      },
    };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({
      llm,
      onAttempt: (n) => calls.push(`attempt:${n}`),
    });
    await b.build('X', []);
    assert.deepEqual(calls.filter((c) => c.startsWith('attempt:')), ['attempt:1', 'attempt:2']);
  });

  test('build() does not invoke onAttempt when onAttempt not provided (back-compat)', async () => {
    const validDossier = {
      schemaVersion: '1.0', companyName: 'X', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = { generateStructured: async () => validDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm }); // no onAttempt
    const out = await b.build('X', []);
    assert.equal(out.companyName, 'X');
  });

  test('build() passes company-research structured generation budget to the LLM adapter', async () => {
    let capturedOptions = null;
    const validDossier = {
      schemaVersion: '1.0', companyName: 'IBM',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = {
      generateStructured: async (_prompt, _schema, options) => {
        capturedOptions = options;
        return validDossier;
      },
    };

    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('IBM', []);

    assert.equal(out.companyName, 'IBM');
    assert.equal(capturedOptions.taskLabel, 'company-research');
    assert.equal(capturedOptions.perProviderTimeoutMs, 35_000);
    assert.equal(capturedOptions.maxOutputTokens, 8_192);
    assert.equal(capturedOptions.maxRotations, 1);
  });
});
