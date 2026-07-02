import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadDetector() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/BusinessSystemTriggerDetector.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('detects explicit PLM trigger and keeps the natural language query', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('根据 PLM 查一下物料 a12345 是什么状态');

  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'plm');
  assert.equal(result.query, '根据 PLM 查一下物料 a12345 是什么状态');
  assert.equal(result.failureReason, undefined);
});

test('detects explicit QMS trigger', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('用 QMS 确认一下上次那个包装问题关了吗');

  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'qms');
});

test('detects explicit business-object lookup without naming PLM or QMS', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();

  for (const question of [
    '查一下物料 a12345 是什么状态',
    '查一下 B55 项目进度怎么样，是谁负责',
  ]) {
    const result = detectBusinessSystemTrigger(question);
    assert.equal(result.shouldQuery, true, question);
    assert.equal(result.sourceHint, 'business_system');
    assert.equal(result.query, question);
  }
});

test('does not trigger on business words without explicit system request', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();

  for (const question of [
    '这个项目进度怎么样',
    'BOM 会影响哪些东西',
    'CAPA 关了吗',
    '这个版本对吗',
  ]) {
    const result = detectBusinessSystemTrigger(question);
    assert.equal(result.shouldQuery, false, question);
    assert.equal(result.failureReason, 'not_explicitly_requested');
  }
});

test('requires an anchor when the explicit request only says this', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger('根据 PLM 回答一下这个怎么样');

  assert.equal(result.shouldQuery, false);
  assert.equal(result.failureReason, 'missing_query_anchor');
  assert.match(result.userMessage, /缺少要查询的物料、项目、图纸、需求或问题线索/);
});

test('uses recent context summary to resolve a vague this request', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger(
    '根据 PLM 回答一下这个怎么样',
    '刚才讨论的是 B55 项目进度和负责人。'
  );

  assert.equal(result.shouldQuery, true);
  assert.equal(result.sourceHint, 'plm');
  assert.equal(result.recentContext, '刚才讨论的是 B55 项目进度和负责人。');
  assert.equal(result.query, '根据 PLM 回答一下这个怎么样');
});

test('limits recent context to three compact sentences', async () => {
  const { detectBusinessSystemTrigger } = await loadDetector();
  const result = detectBusinessSystemTrigger(
    '根据 PLM 回答一下这个怎么样',
    '第一句讲 B55 项目。第二句讲负责人。第三句讲进度。第四句不应该发送。'
  );

  assert.equal(result.shouldQuery, true);
  assert.equal(result.recentContext, '第一句讲 B55 项目。第二句讲负责人。第三句讲进度。');
  assert.doesNotMatch(result.recentContext, /第四句/);
});
