// electron/services/business-system/__tests__/BusinessSystemTriggerDetector.behavior.test.mjs
//
// Behavioral coverage for BusinessSystemTriggerDetector.ts:
//   - Empty / whitespace question → not_explicitly_requested
//   - Triggers: PLM, Windchill, QMS, business_object, business_system keyword
//   - sourceHint resolution per trigger
//   - Vague trigger without anchor → missing_query_anchor
//   - recentContext resolves a vague "this" question
//   - recentContext is compacted to 3 sentences max
//   - Question that is only a question word → not_explicitly_requested

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadDetector() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/BusinessSystemTriggerDetector.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('empty question returns not_explicitly_requested', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('');
  assert.equal(result.shouldQuery, false);
  assert.equal(result.failureReason, 'not_explicitly_requested');
});

test('whitespace-only question returns not_explicitly_requested', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('   \n\t  ');
  assert.equal(result.shouldQuery, false);
  assert.equal(result.failureReason, 'not_explicitly_requested');
});

test('PLM trigger with part number → plm sourceHint and anchor satisfied', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('根据 PLM 查一下物料 a12345');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'plm');
  assert.equal(result.query, '根据 PLM 查一下物料 a12345');
});

test('Windchill trigger with BOM lookup → plm sourceHint', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('查一下 Windchill 里的 PRT-001 BOM');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'plm');
});

test('QMS trigger with CAPA → qms sourceHint', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('用 QMS 确认一下上次那个 CAPA 关了吗');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'qms');
});

test('business_object lookup without naming PLM/QMS → business_system sourceHint', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('查一下物料 a12345 是什么状态');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'business_system');
});

test('explicit 业务系统知识源 trigger → business_system sourceHint', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('根据业务系统知识源查一下 a12345');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'business_system');
});

test('"这个" alone with no anchor and no context → missing_query_anchor', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('根据 PLM 回答一下这个怎么样');
  assert.equal(result.shouldQuery, false);
  assert.equal(result.failureReason, 'missing_query_anchor');
  assert.match(result.userMessage, /缺少/);
});

test('recentContext rescues a vague "this" question', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('根据 PLM 回答一下这个怎么样', '刚才讨论的是 B55 项目进度。');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'plm');
  assert.equal(result.recentContext, '刚才讨论的是 B55 项目进度。');
});

test('recentContext is compacted: multiple spaces become single space', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('根据 PLM 查一下 a12345', '第一句  含   多个空格。');
  // The space compacting should make "第一句 含 多个空格。"
  assert.match(result.recentContext, /第一句 含 多个空格/);
});

test('recentContext is limited to three sentences', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger(
    '根据 PLM 查一下 a12345',
    '第一句讲 B55 项目。第二句讲负责人。第三句讲进度。第四句不应该发送。',
  );
  assert.equal(result.recentContext, '第一句讲 B55 项目。第二句讲负责人。第三句讲进度。');
  assert.doesNotMatch(result.recentContext, /第四句/);
});

test('recentContext with no terminal punctuation: treated as a single sentence', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger(
    '根据 PLM 查一下 a12345',
    'no punctuation at all in this context',
  );
  // Even without terminal punctuation, the whole string is one "sentence"
  assert.equal(result.recentContext, 'no punctuation at all in this context');
});

test('non-trigger question returns not_explicitly_requested', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('今天天气怎么样');
  assert.equal(result.shouldQuery, false);
  assert.equal(result.failureReason, 'not_explicitly_requested');
});

test('mixed-case PLM trigger still works', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  // The Chinese patterns use 根据\s*PLM which is case-sensitive for the
  // English acronym but ignores case via /i flag on the regex. We use a
  // pattern that matches the source patterns directly.
  const result = detectBusinessSystemTrigger('根据 plm 查一下 a12345');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'plm');
});

test('trigger with explicit business_object anchor: BOM number is detected as anchor', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  // "BOM" with a part-number-like anchor triggers business_system
  const result = detectBusinessSystemTrigger('查一下 BOM-001 的状态');
  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'business_system');
});
