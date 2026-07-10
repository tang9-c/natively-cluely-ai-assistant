// LLMHelper.RetryAndScopes.test.mjs
// PR3.2 — withRetry behavior, scope policy denials, scope inference, and
// cleanJsonResponse/processResponse.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

describe('LLMHelper retry + scope helpers (PR3.2)', () => {
  test('withRetry succeeds on the first attempt without retrying', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let calls = 0;
    const result = await helper.withRetry(async () => {
      calls++;
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 1);
  });

  test('withRetry retries on 503 and returns the eventual success', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let calls = 0;
    const result = await helper.withRetry(async () => {
      calls++;
      if (calls < 3) {
        const err = new Error('503 Service Unavailable');
        throw err;
      }
      return 'recovered';
    });
    assert.equal(result, 'recovered');
    assert.equal(calls, 3, 'should retry twice before succeeding on attempt 3');
  });

  test('withRetry retries on 429/500/529 status codes', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    for (const status of [429, 500, 529]) {
      let calls = 0;
      const result = await helper.withRetry(async () => {
        calls++;
        if (calls < 2) {
          const err = new Error(`upstream ${status}`);
          err.status = status;
          throw err;
        }
        return 'ok';
      });
      assert.equal(result, 'ok', `status ${status} should be retried`);
      assert.equal(calls, 2, `status ${status} should succeed on second attempt`);
    }
  });

  test('withRetry retries on rate_limit / rate limit message strings', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let calls = 0;
    const result = await helper.withRetry(async () => {
      calls++;
      if (calls === 1) {
        throw new Error('rate_limit exceeded');
      }
      return 'ok';
    });
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  test('withRetry does NOT retry on a non-retryable error and rethrows it', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let calls = 0;
    await assert.rejects(
      helper.withRetry(async () => {
        calls++;
        throw new Error('400 Bad Request');
      }),
      /400 Bad Request/,
    );
    assert.equal(calls, 1, 'non-retryable errors must not trigger retries');
  });

  test('withRetry gives up after `retries` attempts and throws "Model busy"', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let calls = 0;
    await assert.rejects(
      helper.withRetry(async () => {
        calls++;
        throw new Error('503 Service Unavailable');
      }, 3),
      /Model busy/,
    );
    assert.equal(calls, 3, 'default retries is 3');
  });

  test('cleanJsonResponse strips markdown code fences and trims whitespace', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    assert.equal(helper.cleanJsonResponse('  {"a":1}  '), '{"a":1}');
    assert.equal(helper.cleanJsonResponse('```json\n{"a":1}\n```'), '{"a":1}');
    assert.equal(helper.cleanJsonResponse('```\n{"a":1}\n```'), '{"a":1}');
  });

  test('processResponse throws on fallback phrases ("I am not sure", etc.)', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    for (const phrase of ["I'm not sure", "It depends", "I can't answer", "I don't know"]) {
      assert.throws(
        () => helper.processResponse(phrase),
        /Filtered fallback response/,
        `phrase "${phrase}" must be filtered`,
      );
    }
    // And the cleanup still runs: markdown fences are stripped first.
    assert.equal(helper.processResponse('```json\n{"a":1}\n```'), '{"a":1}');
  });

  test('inferContextScopes returns transcript-relevant scopes for context patterns', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    assert.deepEqual(helper.inferContextScopes(''), [], 'empty context -> []');
    assert.deepEqual(helper.inferContextScopes(null), [], 'null context -> []');

    assert.deepEqual(
      helper.inferContextScopes('Here is a <reference_file>doc</reference_file>'),
      ['reference_files'],
    );
    assert.deepEqual(
      helper.inferContextScopes('<meeting_history>user profile</meeting_history>'),
      ['profile_history'],
    );
    assert.deepEqual(
      helper.inferContextScopes('Post-call summary: <post_call_summary>...</post_call_summary>'),
      ['post_call_summary'],
    );
  });

  test('scopesForPayload always tags transcript by default and screenshots when images are present', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();

    const textOnly = helper.scopesForPayload('hello', []);
    assert.ok(textOnly.includes('transcript'));

    const withImages = helper.scopesForPayload('look', ['/tmp/a.png']);
    assert.ok(withImages.includes('transcript'));
    assert.ok(withImages.includes('screenshots'));

    // When extraScopes is provided, transcript is NOT auto-added.
    const withExtra = helper.scopesForPayload('hello', [], ['reference_files']);
    assert.equal(withExtra.includes('transcript'), false, 'transcript must not be added when extraScopes is non-empty');
    assert.ok(withExtra.includes('reference_files'));
  });

  test('getDeniedOutboundScopes returns [] when no policy is set', () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    const denied = helper.getDeniedOutboundScopes('hello', []);
    assert.deepEqual(denied, [], 'no policy = no denied scopes');
  });
});
