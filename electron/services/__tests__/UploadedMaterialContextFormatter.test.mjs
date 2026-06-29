import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/services/knowledge/UploadedMaterialContextFormatter.js');

async function loadFormatter() {
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('formats uploaded material context within total and per-hit budgets while preserving exact hit text', async () => {
  const { formatUploadedMaterialContext } = await loadFormatter();
  const keyFact = 'SOC2 Type II报告（2025年完成）';
  const context = formatUploadedMaterialContext([
    {
      title: 'Security compliance FAQ',
      text: `核心事实：我们可以提供${keyFact}，同时支持GDPR / CCPA / PDPA适配。`,
      parentText: `${'前置背景。'.repeat(300)} SHOULD_NOT_KEEP_DISTANT_PARENT_CONTEXT ${'后置背景。'.repeat(300)}`,
    },
  ]);

  assert.ok(context.length <= 4200, `context should stay within 4200 chars, got ${context.length}`);
  assert.match(context, /<uploaded_material_context>/);
  assert.match(context, /\[1\] Security compliance FAQ/);
  assert.match(context, new RegExp(keyFact));
  assert.doesNotMatch(context, /SHOULD_NOT_KEEP_DISTANT_PARENT_CONTEXT/);
});

test('formats multiple uploaded material hits with numbered citeable snippets', async () => {
  const { formatUploadedMaterialContext } = await loadFormatter();
  const context = formatUploadedMaterialContext([
    {
      title: 'SOC2',
      text: 'SOC2 Type II报告（2025年完成）。',
      parentText: 'SOC2 Type II报告（2025年完成）。审计覆盖安全、可用性、保密性。',
    },
    {
      title: 'Privacy',
      text: 'GDPR / CCPA / PDPA均已适配。',
      parentText: '隐私合规覆盖GDPR / CCPA / PDPA，并支持安全团队对接。',
    },
  ]);

  assert.match(context, /\[1\] SOC2/);
  assert.match(context, /\[2\] Privacy/);
  assert.match(context, /SOC2 Type II报告（2025年完成）/);
  assert.match(context, /GDPR \/ CCPA \/ PDPA/);
});
