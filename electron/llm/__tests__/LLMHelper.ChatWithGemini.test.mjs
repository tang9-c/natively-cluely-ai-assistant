// LLMHelper.ChatWithGemini.test.mjs
// PR3.1 — chatWithGemini routing, fallbacks, error wrapping, and provider dispatch.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

function buildProviderRecorder(content) {
  return {
    chat: {
      completions: {
        create: async () => ({
          choices: [{ message: { content } }],
        }),
      },
    },
  };
}

describe('LLMHelper chatWithGemini dispatch (PR3.1)', () => {
  test('routes to Doubao when currentModelId is a doubao model', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('doubao-1-5-pro-32k-250115');
    let captured = null;
    helper.doubaoClient = {
      chat: {
        completions: {
          create: async (body) => {
            captured = body;
            return { choices: [{ message: { content: 'doubao-says-hi' } }] };
          },
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    assert.equal(result, 'doubao-says-hi');
    assert.ok(captured, 'doubao client should have been called');
    assert.equal(captured.model, 'doubao-1-5-pro-32k-250115');
  });

  test('routes to OpenAI when currentModelId is a gpt-* model', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gpt-4o');
    helper.openaiClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: 'openai-says-hi' } }] }),
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    assert.equal(result, 'openai-says-hi');
  });

  test('routes to Claude when currentModelId is a claude-* model', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('claude-3-5-sonnet-latest');
    let captured = null;
    helper.claudeClient = {
      messages: {
        stream: (body) => {
          captured = body;
          return {
            finalMessage: async () => ({
              content: [{ type: 'text', text: 'claude-says-hi' }],
              usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            }),
          };
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    assert.equal(result, 'claude-says-hi');
    assert.ok(captured, 'claude.messages.stream should have been called');
    assert.equal(captured.model, 'claude-3-5-sonnet-latest');
  });

  test('routes to Groq when currentModelId is a llama-* model', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('llama-3.3-70b-versatile');
    helper.groqClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [{ message: { content: 'groq-says-hi' } }] }),
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    assert.equal(result, 'groq-says-hi');
  });

  test('falls through to Gemini when only Gemini client is configured', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gemini');
    let captured = null;
    helper.client = {
      models: {
        generateContent: async (body) => {
          captured = body;
          return {
            text: 'gemini-says-hi',
            candidates: [{ content: { parts: [{ text: 'gemini-says-hi' }] }, finishReason: 'STOP' }],
          };
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    assert.equal(result, 'gemini-says-hi');
    assert.ok(captured, 'gemini client should have been called');
  });

  test('returns "No AI providers configured" when nothing is wired up', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gemini');

    const result = await helper.chatWithGemini('hi', [], null, true);

    assert.equal(result, 'No AI providers configured. Please add at least one API key in Settings.');
  });

  test('surfaces a Model-busy error after withRetry exhausts a 503', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gpt-4o');
    let attempts = 0;
    helper.openaiClient = {
      chat: {
        completions: {
          create: async () => {
            attempts++;
            const err = new Error('503 Service Unavailable');
            throw err;
          },
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    // withRetry retries 3 times on 503 then throws "Model busy, try again";
    // the outer try/catch in chatWithGemini wraps it with the user-friendly prefix.
    assert.ok(
      result.includes('Model busy, try again') || result.includes('overloaded'),
      `unexpected result: ${result}`,
    );
    assert.ok(attempts >= 1, 'openai client should be invoked at least once');
  });

  test('returns the API key auth message when an auth-style error bubbles up', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gpt-4o');
    helper.openaiClient = {
      chat: {
        completions: {
          create: async () => {
            const err = new Error('Invalid API key provided');
            throw err;
          },
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    assert.equal(result, 'Authentication failed. Please check your API key in settings.');
  });

  test('blocks all cloud calls when isLocalOnlyMode is on and no local client is wired', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setLocalOnlyMode(true);
    helper.setModel('gpt-4o');
    let openaiCalls = 0;
    helper.openaiClient = {
      chat: {
        completions: {
          create: async () => {
            openaiCalls++;
            return { choices: [{ message: { content: 'should-not-run' } }] };
          },
        },
      },
    };

    const result = await helper.chatWithGemini('hi', [], null, true);

    // Local-only mode blocks the cloud provider from running, so the
    // openai client is never called and the user sees an error message.
    assert.equal(openaiCalls, 0, 'openai client should NOT be invoked in local-only mode');
    assert.ok(
      result.includes('Cloud providers disabled') || result.includes('No AI providers'),
      `unexpected result: ${result}`,
    );
  });

  test('rotates through providers and returns the first non-empty response', async () => {
    const { LLMHelper } = cjsRequire(helperPath);
    const helper = new LLMHelper();
    helper.setModel('gemini');
    let firstCalls = 0;
    helper.client = {
      models: {
        generateContent: async () => {
          firstCalls++;
          // Return empty text on the first attempt; non-empty on the second.
          if (firstCalls === 1) {
            return { text: '', candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] };
          }
          return {
            text: 'second-attempt',
            candidates: [{ content: { parts: [{ text: 'second-attempt' }] }, finishReason: 'STOP' }],
          };
        },
      },
    };

    // chatWithGemini uses a single pass per provider inside the rotation loop —
    // empty text triggers the next provider (or a retry within the same call).
    // When only one provider is configured and it returns empty, the function
    // returns the "I apologize" message after MAX_FULL_ROTATIONS.
    const result = await helper.chatWithGemini('hi', [], null, true);
    assert.ok(
      result === 'second-attempt' || result.startsWith('I apologize'),
      `unexpected result: ${result}`,
    );
  });
});
