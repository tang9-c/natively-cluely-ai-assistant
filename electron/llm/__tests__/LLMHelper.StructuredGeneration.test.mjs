import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

describe('LLMHelper structured generation', () => {
  test('generateContentStructured() falls back when Doubao exceeds per-provider timeout', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.doubaoClient = {
      chat: {
        completions: {
          create: () => new Promise(() => {}),
        },
      },
    };
    helper.groqClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }),
        },
      },
    };

    const started = Date.now();
    const result = await helper.generateContentStructured('return json', {
      taskLabel: 'test',
      perProviderTimeoutMs: 40,
      maxOutputTokens: 128,
      maxRotations: 1,
    });

    assert.equal(result, '{"ok":true}');
    assert.ok(Date.now() - started < 1000);
  });

  test('generateContentStructured() passes Research-sized max output tokens to Doubao', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    let capturedBody = null;
    helper.doubaoClient = {
      chat: {
        completions: {
          create: async (body) => {
            capturedBody = body;
            return { choices: [{ message: { content: '{"ok":true}' } }] };
          },
        },
      },
    };

    const result = await helper.generateContentStructured('return json', {
      taskLabel: 'company-research',
      perProviderTimeoutMs: 1000,
      maxOutputTokens: 8192,
      maxRotations: 1,
    });

    assert.equal(result, '{"ok":true}');
    assert.equal(capturedBody.max_completion_tokens, 8192);
  });
});
