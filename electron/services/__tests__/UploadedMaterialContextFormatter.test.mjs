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
  const result = formatUploadedMaterialContext([
    {
      title: 'Security compliance FAQ',
      text: `核心事实：我们可以提供${keyFact}，同时支持GDPR / CCPA / PDPA适配。`,
      parentText: `${'前置背景。'.repeat(300)} SHOULD_NOT_KEEP_DISTANT_PARENT_CONTEXT ${'后置背景。'.repeat(300)}`,
    },
  ]);
  const { text: context, truncated } = result;

  assert.ok(context.length <= 4200, `context should stay within 4200 chars, got ${context.length}`);
  assert.equal(truncated, true);
  assert.match(context, /<uploaded_material_context>/);
  assert.match(context, /\[1\] Security compliance FAQ/);
  assert.match(context, new RegExp(keyFact));
  assert.doesNotMatch(context, /SHOULD_NOT_KEEP_DISTANT_PARENT_CONTEXT/);
});

test('formats multiple uploaded material hits with numbered citeable snippets', async () => {
  const { formatUploadedMaterialContext } = await loadFormatter();
  const { text: context, truncated } = formatUploadedMaterialContext([
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

  assert.equal(truncated, false);
  assert.match(context, /\[1\] SOC2/);
  assert.match(context, /\[2\] Privacy/);
  assert.match(context, /SOC2 Type II报告（2025年完成）/);
  assert.match(context, /GDPR \/ CCPA \/ PDPA/);
});

test('normalizeText coerces non-string values to empty string', async () => {
  const { formatUploadedMaterialContext } = await loadFormatter();
  // Pass an entry with non-string text/parentText — they must not crash and
  // must not contribute to the rendered output.
  const { text } = formatUploadedMaterialContext([
    { title: 'Nulls', text: null, parentText: undefined },
    { title: 'Number', text: 42, parentText: { weird: 'object' } },
  ]);
  // Header is still emitted but body is empty; no NaN/null literal bleeds in.
  assert.equal(typeof text, 'string');
  assert.equal(text.includes('null'), false);
  assert.equal(text.includes('undefined'), false);
  assert.equal(text.includes('42'), false);
});

test('honors custom maxTotalChars and maxPerHitChars overrides', async () => {
  const { formatUploadedMaterialContext } = await loadFormatter();
  const { text, truncated } = formatUploadedMaterialContext(
    [
      {
        title: 'Long',
        text: 'A'.repeat(500),
        parentText: 'B'.repeat(500),
      },
    ],
    { maxTotalChars: 100, maxPerHitChars: 50 },
  );
  assert.equal(truncated, true);
  // Per-hit truncation must keep the marker + a small slice — bounded well
  // below the original 500 chars.
  assert.ok(text.length < 200, `expected truncated output, got ${text.length} chars`);
});

test('truncation marker kicks in for per-hit overflow', async () => {
  const { formatUploadedMaterialContext } = await loadFormatter();
  const { text, truncated } = formatUploadedMaterialContext([
    {
      title: 'Overflow',
      text: 'C'.repeat(2000),
      parentText: 'D'.repeat(2000),
    },
  ]);
  assert.equal(truncated, true);
  // Default per-hit cap is small enough that the marker should appear.
  assert.match(text, /\[\.\.\.\]|\.\.\.|…/);
});
