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

  // Debug session 2026-06-22: when attempt 1 times out (LLM is slow),
  // retrying with attempt 2 wastes another full per-provider timeout —
  // observed 45s + 45s = 90s of waiting for the same outcome. The builder
  // must surface LLM_TIMEOUT immediately on attempt 1 timeout, with no
  // second LLM call.
  test('build() does NOT retry when attempt 1 throws a timeout', async () => {
    let calls = 0;
    const llm = {
      generateStructured: async () => {
        calls++;
        throw new Error('Doubao Pro company-research structured generation timed out after 45000ms');
      },
    };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const started = Date.now();
    await assert.rejects(
      () => b.build('Apple', [{ title: 't', url: 'https://x.example', content: 's' }]),
      /timed out|invalid dossier/i,
    );
    const elapsed = Date.now() - started;
    assert.equal(calls, 1, 'attempt 1 must NOT be retried on timeout');
    // No full per-provider timeout budget consumed: should complete in well
    // under the 45s per-provider budget since the mock throws synchronously.
    assert.ok(elapsed < 5_000, `expected fast failure, took ${elapsed}ms`);
  });

  // Schema-shape failures (non-timeout) should still retry — normalize catches
  // most cases but if a new LLM shape slips past, retry is the second line of
  // defense.
  test('build() DOES retry when attempt 1 throws a non-timeout error', async () => {
    let calls = 0;
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
        calls++;
        if (calls === 1) throw new Error('some non-timeout LLM error');
        return validDossier;
      },
    };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('X', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(calls, 2, 'non-timeout errors must still trigger attempt 2');
    assert.equal(out.companyName, 'X');
  });

  test('build() throws LlmInvalidFormatError after retry exhaustion', async () => {
    const llm = { generateStructured: async () => { throw new Error('still bad'); } };
    const { ResearchDossierBuilder, LlmInvalidFormatError } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    await assert.rejects(() => b.build('X', []), (err) => err instanceof LlmInvalidFormatError);
  });

  // Regression guard 2026-06-22: Doubao Pro (zh-prompt) returned `bullets`
  // instead of `details` and Chinese confidence ("高") instead of the enum
  // ('high'|'medium'|'low'). The builder must normalize both before schema
  // validation, otherwise it throws LlmInvalidFormatError on every call.
  test('build() accepts LLM output with `bullets` alias for `details`', async () => {
    const llmDossier = {
      financials: { summary: 's', bullets: [{ text: 'a' }, { text: 'b' }], confidence: 'high' },
      business: { summary: 's', bullets: [], confidence: 'high' },
      strategy: { summary: 's', bullets: [], confidence: 'high' },
      people: { summary: 's', bullets: [], confidence: 'high' },
      infrastructure: { summary: 's', bullets: [], confidence: 'high' },
      procurement: { summary: 's', bullets: [], confidence: 'high' },
    };
    const llm = { generateStructured: async () => llmDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    // Non-empty sources so maybeDowngrade does not force everything to "low".
    const out = await b.build('Apple', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.financials.details.length, 2);
    assert.equal(out.financials.details[0].text, 'a');
  });

  test('build() normalizes Chinese confidence values to enum', async () => {
    const llmDossier = {
      financials: { summary: 's', details: [], confidence: '高' },
      business: { summary: 's', details: [], confidence: '中' },
      strategy: { summary: 's', details: [], confidence: '低' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'medium' },
      procurement: { summary: 's', details: [], confidence: 'low' },
    };
    const llm = { generateStructured: async () => llmDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.financials.confidence, 'high');
    assert.equal(out.business.confidence, 'medium');
    assert.equal(out.strategy.confidence, 'low');
    assert.equal(out.people.confidence, 'high');
  });

  // Regression guard 2026-06-22 (final review I1): a non-timeout error that
  // happens to contain the word "timeout" (e.g. a network "request timeout
  // exceeded" or user-content "non timeout") must NOT be treated as the
  // per-provider timeout. Treating it as such skips attempt 2 and surfaces
  // LLM_TIMEOUT to the user when a retry would have succeeded. The regex in
  // isTimeoutError() must match the exact LLMHelper.withTimeout format only.
  test('build() DOES retry when attempt 1 throws a non-timeout error containing "timeout"', async () => {
    let calls = 0;
    const validDossier = {
      schemaVersion: '1.0', companyName: 'X', generatedAt: '', expiresAt: '',
      source: 'tavily',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [{ index: 1, title: 't', url: 'https://x.example', snippet: 's' }],
    };
    const llm = {
      generateStructured: async () => {
        calls++;
        if (calls === 1) throw new Error('network: request timeout exceeded after 5000ms');
        return validDossier;
      },
    };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('X', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(calls, 2, 'network "timeout" must not be treated as per-provider timeout');
    assert.equal(out.companyName, 'X');
  });

  // Regression guard 2026-06-22 (final review I3): when LLM omits sources in
  // the dossier even though Tavily provided them, source must be 'llm-fallback'
  // (not 'tavily'). Otherwise the UI shows a Tavily badge with no links.
  test('build() marks source=llm-fallback when LLM omits sources (non-empty Tavily input)', async () => {
    const llmDossier = {
      schemaVersion: '1.0', companyName: 'X',
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      // sources intentionally omitted — normalize injects []; source must
      // downgrade to llm-fallback.
    };
    const llm = { generateStructured: async () => llmDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('X', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.source, 'llm-fallback', 'LLM-omitted sources must downgrade source to llm-fallback');
  });

  test('build() injects schemaVersion and companyName when LLM omits them', async () => {
    const llmDossier = {
      financials: { summary: 's', details: [], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [],
    };
    const llm = { generateStructured: async () => llmDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', []);
    assert.equal(out.schemaVersion, '1.0');
    assert.equal(out.companyName, 'Apple');
  });

  // Debug session 2026-06-22 (third sample, 安吉尔): the model returned a
  // completely different top-level shape on retry — { company, dimensions:
  // [{name, summary, bullets, confidence}, ...] } instead of the documented
  // flat {financials, business, ...}. The normalizer must unwrap this.
  test('build() unwraps {company, dimensions:[{name,...}]} wrapper shape', async () => {
    const llmWrapper = {
      company: '安吉尔',
      dimensions: [
        { name: 'financials', summary: 'a', bullets: [{ text: 'f1' }], confidence: 'low' },
        { name: 'business', summary: 'b', bullets: [{ text: 'b1' }], confidence: 'high' },
        { name: 'strategy', summary: 'c', bullets: [], confidence: 'medium' },
        { name: 'people', summary: 'd', bullets: [], confidence: 'low' },
        { name: 'infrastructure', summary: 'e', bullets: [], confidence: 'high' },
        { name: 'procurement', summary: 'f', bullets: [], confidence: 'low' },
      ],
    };
    const llm = { generateStructured: async () => llmWrapper };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('安吉尔', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.financials.summary, 'a');
    assert.equal(out.business.confidence, 'high');
    assert.equal(out.financials.details[0].text, 'f1');
  });

  // Debug session 2026-06-22 (third sample, attempt=1): bullets were a
  // string[] instead of {text, citation?} objects. The normalizer wraps
  // each string into {text: ...}.
  test('build() wraps string[] bullets into {text} objects', async () => {
    const llmDossier = {
      financials: { summary: 's', bullets: ['first fact', 'second fact'], confidence: 'low' },
      business: { summary: 's', bullets: [], confidence: 'high' },
      strategy: { summary: 's', bullets: [], confidence: 'high' },
      people: { summary: 's', bullets: [], confidence: 'high' },
      infrastructure: { summary: 's', bullets: [], confidence: 'high' },
      procurement: { summary: 's', bullets: [], confidence: 'high' },
    };
    const llm = { generateStructured: async () => llmDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.financials.details.length, 2);
    assert.equal(out.financials.details[0].text, 'first fact');
    assert.equal(out.financials.details[1].text, 'second fact');
  });

  // Debug session 2026-06-22 (third sample): confidence arrived as "Low"
  // (capitalized) and "HIGH" (uppercase). Normalize must be case-insensitive.
  test('build() normalizes confidence case-insensitively', async () => {
    const llmDossier = {
      financials: { summary: 's', details: [], confidence: 'Low' },
      business: { summary: 's', details: [], confidence: 'HIGH' },
      strategy: { summary: 's', details: [], confidence: 'medium' },
      people: { summary: 's', details: [], confidence: 'low' },
      infrastructure: { summary: 's', details: [], confidence: 'Medium' },
      procurement: { summary: 's', details: [], confidence: 'low' },
    };
    const llm = { generateStructured: async () => llmDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('Apple', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.financials.confidence, 'low');
    assert.equal(out.business.confidence, 'high');
    assert.equal(out.infrastructure.confidence, 'medium');
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
    // Raised 45_000 → 90_000 (debug session 2026-06-22, follow-up): user
    // observed random timeouts where the LLM call took 45-90s. 90s gives
    // 30-60s headroom over the slow end without making a hung request block
    // forever. Synthesis budget (120s) accommodates one 90s call + buffer;
    // the smart retry still skips attempt 2 on timeout (no second 90s wait).
    assert.equal(capturedOptions.perProviderTimeoutMs, 90_000);
    // Token budget history (debug sessions 2026-06-21 / 2026-06-22):
    //   8_192 → 2_048 (2026-06-21): 8K ceiling forced the model to consume
    //     the entire budget generating filler.
    //   2_048 → 4_096 (2026-06-22): the Pro model is now producing real
    //     content; 安克创新 dossier hit 4,900+ chars and tripped JSON.parse
    //     with "Unterminated string" inside the budget wall. 4_096 gives
    //     headroom for real-world output while staying well below the 8K
    //     failure ceiling. Do NOT raise back to 8_192.
    assert.equal(capturedOptions.maxOutputTokens, 4_096);
    assert.equal(capturedOptions.maxRotations, 1);
  });

  // Debug session 2026-06-22: normalizeDossier must report which rules fired
  // so the per-stage [Research] log line can list them. Earlier version
  // returned just `normalized`, hiding whether the LLM output deviated.
  test('build() emits per-attempt rule list when LLM output deviates from schema', async () => {
    let capturedOptions = null;
    const validDossier = {
      financials: { summary: 's', bullets: [{ text: 'a' }], confidence: '高' },
      business: { summary: 's', bullets: [], confidence: '高' },
      strategy: { summary: 's', bullets: [], confidence: 'high' },
      people: { summary: 's', bullets: [], confidence: 'high' },
      infrastructure: { summary: 's', bullets: [], confidence: 'high' },
      procurement: { summary: 's', bullets: [], confidence: 'high' },
      // no schemaVersion, no companyName, no sources — all injected by normalize
    };
    const llm = {
      generateStructured: async (_p, _s, options) => {
        capturedOptions = options;
        return validDossier;
      },
    };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    // Spy on console.log so we can observe the [Research] stage=normalize line
    // emitted by researchLog(). This indirectly verifies that normalizeDossier
    // returned the expected rule identifiers, since `normalizeDossier` is not
    // exported from the module and the `rules` array is internal to build().
    const originalLog = console.log;
    const lines = [];
    console.log = (...args) => {
      lines.push(args.join(' '));
      originalLog(...args);
    };
    let out;
    try {
      // Pass non-empty sources so maybeDowngrade does not force all confidence to 'low'.
      out = await b.build('Apple', [{ title: 't', url: 'https://x.example', content: 's' }]);
    } finally {
      console.log = originalLog;
    }
    // End-to-end normalize behavior: bullets → details, Chinese → enum,
    // schemaVersion/companyName/sources injected.
    assert.equal(out.financials.details[0].text, 'a');
    assert.equal(out.financials.confidence, 'high');
    assert.equal(out.business.confidence, 'high');
    assert.equal(out.schemaVersion, '1.0');
    assert.equal(out.companyName, 'Apple');
    // Sanity: the request still carries the structured-generation budget.
    assert.equal(capturedOptions.taskLabel, 'company-research');
    // Verify the [Research] stage=normalize log line lists each rule that fired.
    const normalizeLine = lines.find((l) => l.includes('[Research] stage=normalize'));
    assert.ok(normalizeLine, `expected a [Research] stage=normalize log line, got: ${JSON.stringify(lines)}`);
    for (const ruleId of [
      'bullets→details',
      'zh-confidence→enum',
      'inject-schemaVersion',
      'inject-companyName',
      'inject-sources',
    ]) {
      assert.ok(
        normalizeLine.includes(ruleId),
        `expected rule ${ruleId} in normalize log line, got: ${normalizeLine}`,
      );
    }
  });

  // Debug session 2026-06-23 (麦科田 sample, position 3064 line 117 col 32):
  // Doubao Pro emitted pretty-printed JSON where long string values
  // (e.g. multi-line `summary` fields) contained LITERAL raw newlines inside
  // the string literal — invalid per RFC 8259 §7. V8's JSON.parse rejects the
  // payload with `Bad control character in string literal in JSON at position N`
  // and the dossier is rejected as `LLM_FAILED`. The parser must sanitize
  // these raw control characters (escape them as \n / \t / \r / \u00XX) when
  // they appear inside JSON string literals before handing off to JSON.parse.
  // This test reproduces that exact LLM-output shape end-to-end through
  // `build()` (LLM returns the raw string, not a parsed object) so we catch
  // regressions in the sanitizer, not just in JSON.parse itself.
  test('build() accepts LLM output with raw newline characters inside JSON string values', async () => {
    // Hand-craft a raw LLM response that mirrors what Doubao Pro produces on
    // Chinese prompts: pretty-printed JSON, multi-line `summary` strings with
    // raw \n bytes inside the quoted value. Position 3064 in the real sample
    // is inside the 4th dimension's `summary` — reproducing here at smaller
    // scale is enough to exercise the sanitizer path end-to-end.
    const rawLlmOutput = [
      '{',
      '  "schemaVersion": "1.0",',
      '  "companyName": "麦科田",',
      '  "financials": {',
      // raw LF inside the string literal — invalid JSON, exactly the
      // production failure mode.
      '    "summary": "麦科田是一家医疗器械公司，\n营收持续增长。",',
      '    "details": [ { "text": "医疗器械制造" } ],',
      '    "confidence": "high"',
      '  },',
      '  "business":    { "summary": "s", "details": [], "confidence": "high" },',
      '  "strategy":    { "summary": "s", "details": [], "confidence": "high" },',
      '  "people":      { "summary": "s", "details": [], "confidence": "high" },',
      '  "infrastructure": { "summary": "s", "details": [], "confidence": "high" },',
      '  "procurement": { "summary": "s", "details": [], "confidence": "high" },',
      '  "sources": []',
      '}',
    ].join('\n');

    // Sanity check the fixture itself: JSON.parse on the unfixed raw output
    // must throw the same V8 error the production logs show. If this stops
    // throwing in a future Node version, the sanitizer is no longer needed
    // and this test (and the sanitizer) can be deleted.
    assert.throws(
      () => JSON.parse(rawLlmOutput),
      /Bad control character in string literal/,
      'fixture must reproduce the production parse failure mode',
    );

    const llm = { generateStructured: async () => rawLlmOutput };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('麦科田', [{ title: 't', url: 'https://x.example', content: 's' }]);

    // The raw LF inside `summary` should have been escaped to a 2-char \n
    // sequence by the sanitizer, parsed back, and the newline must survive
    // in the resulting string. (JSON.parse re-interprets \n escape sequences
    // back into the original newline byte in the resulting JS string.)
    assert.equal(out.financials.summary, '麦科田是一家医疗器械公司，\n营收持续增长。');
    assert.equal(out.financials.details[0].text, '医疗器械制造');
    assert.equal(out.companyName, '麦科田');
  });

  // Debug session 2026-06-23: same root cause as above, but the raw control
  // character appears inside a bullet's `text` field. This is the most
  // common shape in practice (LLMs put pretty line breaks inside long bullet
  // descriptions as well as summaries). The sanitizer must handle nested
  // string values, not just top-level ones.
  test('build() accepts LLM output with raw tab characters inside nested bullet text', async () => {
    const rawLlmOutput = [
      '{',
      '  "schemaVersion": "1.0",',
      '  "companyName": "X",',
      '  "financials": {',
      // Raw TAB (0x09) inside the bullet text — also a "Bad control character".
      '    "summary": "ok",',
      '    "details": [ { "text": "first\tsecond\tthird" } ],',
      '    "confidence": "high"',
      '  },',
      '  "business":    { "summary": "s", "details": [], "confidence": "high" },',
      '  "strategy":    { "summary": "s", "details": [], "confidence": "high" },',
      '  "people":      { "summary": "s", "details": [], "confidence": "high" },',
      '  "infrastructure": { "summary": "s", "details": [], "confidence": "high" },',
      '  "procurement": { "summary": "s", "details": [], "confidence": "high" },',
      '  "sources": []',
      '}',
    ].join('\n');

    assert.throws(
      () => JSON.parse(rawLlmOutput),
      /Bad control character in string literal/,
      'fixture must reproduce the production parse failure mode',
    );

    const llm = { generateStructured: async () => rawLlmOutput };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    const out = await b.build('X', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.financials.details[0].text, 'first\tsecond\tthird');
  });

  // Debug session 2026-06-23: regression guard. The sanitizer must NOT
  // touch control characters that appear OUTSIDE string literals (between
  // tokens, in whitespace). Pretty-printed JSON relies on raw \n between
  // fields being preserved as-is. Naively escaping every control char in
  // the entire payload would break that and JSON.parse would fail with a
  // different error.
  test('build() preserves raw newlines outside JSON string literals (between fields)', async () => {
    // Construct a payload identical to the tab-in-bullet test, but with all
    // string contents valid. The raw newlines between fields are the only
    // control chars and they live OUTSIDE strings — the sanitizer must
    // leave them alone.
    const rawLlmOutput = [
      '{',
      '  "schemaVersion": "1.0",',
      '  "companyName": "X",',
      '  "financials":    { "summary": "s", "details": [], "confidence": "high" },',
      '  "business":      { "summary": "s", "details": [], "confidence": "high" },',
      '  "strategy":      { "summary": "s", "details": [], "confidence": "high" },',
      '  "people":        { "summary": "s", "details": [], "confidence": "high" },',
      '  "infrastructure": { "summary": "s", "details": [], "confidence": "high" },',
      '  "procurement":   { "summary": "s", "details": [], "confidence": "high" },',
      '  "sources": []',
      '}',
    ].join('\n');

    const llm = { generateStructured: async () => rawLlmOutput };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    // Should succeed without throwing — pretty-printed JSON (raw \n between
    // fields, no control chars inside strings) is already valid.
    const out = await b.build('X', [{ title: 't', url: 'https://x.example', content: 's' }]);
    assert.equal(out.companyName, 'X');
    assert.equal(out.sources.length, 0);
  });

  // Debug session 2026-06-23 (正浩创新 sample): LLM emitted `citation: null`
  // for bullets it had no source to cite. Zod's `.optional()` accepts
  // `undefined` but rejects `null`, producing 11 invalid_type errors across
  // 5 dimensions. Schema now uses `.nullish()` AND normalizeBullets deletes
  // null citations so the diff loop in normalizeDossier can report the rule.
  test('build() accepts citation:null in bullet details and logs null-citation→undefined', async () => {
    const llmDossier = {
      financials: { summary: 's', details: [{ text: 'a', citation: null }, { text: 'b' }], confidence: 'high' },
      business: { summary: 's', details: [], confidence: 'high' },
      strategy: { summary: 's', details: [], confidence: 'high' },
      people: { summary: 's', details: [], confidence: 'high' },
      infrastructure: { summary: 's', details: [], confidence: 'high' },
      procurement: { summary: 's', details: [], confidence: 'high' },
      sources: [{ index: 1, title: 't', url: 'https://x.example', snippet: 's' }],
    };
    const llm = { generateStructured: async () => llmDossier };
    const { ResearchDossierBuilder } = cjsRequire(builderPath);
    const b = new ResearchDossierBuilder({ llm });
    // Spy on console.log so we can capture the [Research] stage=normalize line.
    const originalLog = console.log;
    const lines = [];
    console.log = (...args) => {
      lines.push(args.join(' '));
      originalLog(...args);
    };
    let out;
    try {
      // Pass non-empty sources so maybeDowngrade does not force confidence to 'low'.
      out = await b.build('Apple', [{ title: 't', url: 'https://x.example', content: 's' }]);
    } finally {
      console.log = originalLog;
    }
    // The first bullet had citation:null; normalize drops it so the property
    // is undefined on the returned dossier (and absent after JSON serialization).
    assert.ok(out.financials.details[0]);
    assert.equal(out.financials.details[0].text, 'a');
    assert.equal(out.financials.details[0].citation, undefined);
    // The second bullet had no citation to begin with; it stays undefined.
    assert.equal(out.financials.details[1].citation, undefined);
    // Verify the [Research] stage=normalize log line reports the rule.
    const normalizeLine = lines.find((l) => l.includes('[Research] stage=normalize'));
    assert.ok(normalizeLine, `expected a [Research] stage=normalize log line, got: ${JSON.stringify(lines)}`);
    assert.ok(
      normalizeLine.includes('null-citation→undefined'),
      `expected rule null-citation→undefined in normalize log line, got: ${normalizeLine}`,
    );
  });
});
