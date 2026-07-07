import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('pptx font mapping contains common CJK aliases and one platform target', () => {
  const mod = require('../../../../dist-electron/electron/services/knowledge/pptx/createPptxFontMapping.js');
  assert.equal(typeof mod.createPptxFontMapping, 'function');
  assert.ok(Array.isArray(mod.PPTX_FONT_SOURCE_NAMES));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('微软雅黑'));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('PingFang SC'));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('Noto Sans CJK SC'));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('阿里巴巴普惠体'));
  assert.match(mod.PPTX_UNIFIED_FONT, /STHeiti Medium|Microsoft YaHei|Noto Sans CJK SC/);
});

test('pptx markdown parser enforces exactly five hypothetical questions', () => {
  const mod = require('../../../../dist-electron/electron/services/knowledge/pptx/PptxMarkdownParser.js');
  const parsed = mod.parsePptxEnhanceJson(JSON.stringify({
    summary: '该页介绍企业版权限和审计能力。',
    hypothetical_questions: ['问题1', '问题2', '问题3', '问题4', '问题5'],
  }));
  assert.equal(parsed.summary, '该页介绍企业版权限和审计能力。');
  assert.deepEqual(parsed.hypotheticalQuestions, ['问题1', '问题2', '问题3', '问题4', '问题5']);
  assert.throws(
    () => mod.parsePptxEnhanceJson(JSON.stringify({ summary: 'x', hypothetical_questions: ['one'] })),
    /pptx_enhance_invalid_questions/,
  );
});
