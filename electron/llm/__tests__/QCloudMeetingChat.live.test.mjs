import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const helperPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');

const RUN_LIVE = process.env.QCLOUD_LIVE_CHAT_TESTS === '1';
const QCLOUD_KEY = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;

async function drainStream(stream) {
  let text = '';
  for await (const chunk of stream) {
    text += chunk;
  }
  return text.trim();
}

test('live QCLOUD key can answer a meeting chat turn through LLMHelper.streamChat()', {
  timeout: 30000,
  skip: !RUN_LIVE
    ? 'Set QCLOUD_LIVE_CHAT_TESTS=1 to run the live QCLOUD meeting chat smoke test.'
    : !QCLOUD_KEY
      ? 'Set QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY to run the live QCLOUD meeting chat smoke test.'
      : false,
}, async () => {
  const { LLMHelper } = await import(pathToFileURL(helperPath).href);
  const helper = new LLMHelper();
  helper.setNativelyKey(QCLOUD_KEY);
  helper.setModel('natively');

  const meetingContext = [
    '模式：销售',
    '语音转写正常',
    '无屏幕上下文',
    '云端 LLM 路由',
    '客户：我们想先做一个小范围试点，应该怎么开始？',
  ].join('\n');

  const response = await drainStream(helper.streamChat(
    '该说什么？请给一句自然的中文销售回应。',
    undefined,
    meetingContext,
    '你是会议中的实时销售助手。请直接给可说出口的一句话，不要解释。',
    true,
  ));

  assert.ok(response.length > 0, 'QCLOUD meeting chat should return a non-empty response');
  assert.doesNotMatch(response, /No AI provider configured/i);
  assert.doesNotMatch(response, /Please add at least one API key/i);
});
