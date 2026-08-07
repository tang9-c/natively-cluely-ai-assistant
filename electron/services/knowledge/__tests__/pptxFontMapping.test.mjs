import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('pptx font mapping sends common CJK aliases to the bundled Noto family', () => {
  const mod = require('../../../../dist-electron/electron/services/knowledge/pptx/createPptxFontMapping.js');
  assert.equal(typeof mod.createPptxFontMapping, 'function');
  assert.ok(Array.isArray(mod.PPTX_FONT_SOURCE_NAMES));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('微软雅黑'));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('PingFang SC'));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('Noto Sans CJK SC'));
  assert.ok(mod.PPTX_FONT_SOURCE_NAMES.includes('阿里巴巴普惠体'));
  assert.equal(mod.PPTX_UNIFIED_FONT, 'Noto Sans CJK SC');
});

test('PPTX renderer bundles a redistributable font and renders 1280px slides without downscaling', () => {
  const root = path.resolve(import.meta.dirname, '../../../..');
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const renderChild = fs.readFileSync(
    path.join(root, 'electron/services/knowledge/pptx/pptx-render-child.mjs'),
    'utf8',
  );

  assert.equal(
    packageJson.build.extraResources.some((entry) => entry.from === 'resources/fonts' && entry.to === 'fonts'),
    true,
  );
  assert.equal(fs.existsSync(path.join(root, 'resources/fonts/NotoSansCJKsc-Regular.otf')), true);
  assert.equal(fs.existsSync(path.join(root, 'resources/fonts/OFL.txt')), true);
  assert.match(renderChild, /width:\s*1280/);
  assert.match(renderChild, /skipSystemFonts:\s*false/);
  assert.match(renderChild, /fontDirs:/);
  assert.doesNotMatch(renderChild, /\.resize\(640,\s*360/);
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
