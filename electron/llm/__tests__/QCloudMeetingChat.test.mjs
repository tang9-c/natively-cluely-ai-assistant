import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

async function drainStream(stream) {
  let text = '';
  for await (const chunk of stream) {
    text += chunk;
  }
  return text;
}

test('QCLOUD streamChat surfaces QCLOUD failures instead of reporting no provider', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Invalid token' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');

    await assert.rejects(
      drainStream(helper.streamChat('会议中该怎么回复客户？', undefined, '模式：销售', undefined, true)),
      (error) => {
        assert.match(error.message, /QCLOUD API/i);
        assert.match(error.message, /401|Invalid token/i);
        assert.doesNotMatch(error.message, /No AI provider configured/i);
        return true;
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('QCLOUD streamChatWithGemini surfaces QCLOUD failures when it is the only provider', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({ error: { message: 'Invalid token' } }),
    { status: 401, headers: { 'content-type': 'application/json' } },
  );

  try {
    const { LLMHelper } = await import(pathToFileURL(helperPath).href);
    const helper = new LLMHelper();
    helper.setNativelyKey('test-qcloud-key');
    helper.setModel('natively');

    const text = await drainStream(helper.streamChatWithGemini('搜索所有会议：客户试点怎么开始？', undefined, undefined, true));

    assert.match(text, /QCLOUD API/i);
    assert.match(text, /401|Invalid token/i);
    assert.doesNotMatch(text, /All AI services are currently unavailable/i);
    assert.doesNotMatch(text, /No AI provider configured/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
