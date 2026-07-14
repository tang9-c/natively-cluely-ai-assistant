import 'dotenv/config';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const helperPath = path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js');
const whatToAnswerPath = path.resolve(repoRoot, 'dist-electron/electron/llm/WhatToAnswerLLM.js');

const QCLOUD_KEY = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
const RUNTIME_FIRST_TOKEN_TIMEOUT_MS = 12_000;

function readFixture(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

async function createQCloudHelper() {
  const { LLMHelper } = await import(pathToFileURL(helperPath).href);
  const helper = new LLMHelper();
  helper.setNativelyKey(QCLOUD_KEY);
  helper.setModel('natively');
  return helper;
}

async function measureFirstToken(stream) {
  const startedAt = performance.now();
  let firstTokenMs = null;
  let text = '';
  for await (const chunk of stream) {
    if (firstTokenMs === null && chunk) firstTokenMs = performance.now() - startedAt;
    text += chunk;
  }
  return {
    firstTokenMs: firstTokenMs === null ? Number.POSITIVE_INFINITY : Math.round(firstTokenMs),
    text: text.trim(),
  };
}

test('live QCLOUD streamChat returns first token inside runtime timeout with sales fixture context', {
  timeout: 30000,
}, async () => {
  assert.ok(QCLOUD_KEY, 'Set QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY to run live QCLOUD streaming latency tests.');
  const helper = await createQCloudHelper();
  const transcript = readFixture('tests/fixtures/demo/05_segment_clips/seg1_sales.md');
  const reference = readFixture('tests/fixtures/demo/04_mode_reference_files/sales/pricing_objections.md');
  const context = [
    '模式：销售',
    transcript,
    '<uploaded_material_context>',
    reference,
    '</uploaded_material_context>',
  ].join('\n\n');

  const result = await measureFirstToken(helper.streamChat(
    '客户问小范围试点如何开始。请给一句可以直接说出口的中文销售回应。',
    undefined,
    context,
    '你是会议中的实时销售助手。只输出一句自然回应。',
    true,
    true,
    ['reference_files'],
    { maxOutputTokens: 768 },
  ));

  assert.ok(
    result.firstTokenMs < RUNTIME_FIRST_TOKEN_TIMEOUT_MS,
    `expected first token < ${RUNTIME_FIRST_TOKEN_TIMEOUT_MS}ms, got ${result.firstTokenMs}ms`,
  );
  assert.ok(result.text.length > 0, 'expected non-empty QCLOUD response');
  assert.doesNotMatch(result.text, /No AI provider configured|Please add at least one API key/i);
});

test('live QCLOUD WhatToAnswer handles FDE fixture inside runtime first token timeout', {
  timeout: 30000,
}, async () => {
  assert.ok(QCLOUD_KEY, 'Set QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY to run live QCLOUD streaming latency tests.');
  const helper = await createQCloudHelper();
  const { WhatToAnswerLLM } = await import(pathToFileURL(whatToAnswerPath).href);
  const transcript = readFixture('tests/fixtures/demo/05_segment_clips/seg5_fde.md');
  const reference = readFixture('tests/fixtures/demo/04_mode_reference_files/fde/prototype_scope.md');
  const answerer = new WhatToAnswerLLM(helper, {
    getActiveModeSystemPromptSuffix: () => 'You are an FDE helping with manufacturing PLM/QMS AI Agent deployment. Do not invent owner, date, or artifact fields.',
    buildActiveModeContextBlock: () => '',
    buildRetrievedActiveModeContextBlock: () => `<uploaded_material_context>${reference}</uploaded_material_context>`,
  });

  const result = await measureFirstToken(answerer.generateStream(
    transcript,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    `<uploaded_material_context>${reference}</uploaded_material_context>`,
    undefined,
    { modeTemplateType: 'fde', intent: 'prototype_scope', latestTurn: '客户问 prototype scope 和下一步怎么确认。' },
  ));

  assert.ok(
    result.firstTokenMs < RUNTIME_FIRST_TOKEN_TIMEOUT_MS,
    `expected first token < ${RUNTIME_FIRST_TOKEN_TIMEOUT_MS}ms, got ${result.firstTokenMs}ms`,
  );
  assert.ok(result.text.length > 0, 'expected non-empty FDE answer');
  assert.doesNotMatch(result.text, /No AI provider configured|Please add at least one API key/i);
});
