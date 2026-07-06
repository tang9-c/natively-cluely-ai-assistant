import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadFormatter() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/knowledge/UploadedMaterialContextFormatter.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

async function loadResolver() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/context/AnswerCitationResolver.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('uploaded FAQ context carries unique product facts without introducing refund hallucinations', async () => {
  const { formatUploadedMaterialContext } = await loadFormatter();
  const { buildUploadedMaterialCitation } = await loadResolver();
  const faqText = [
    'CueUp Enterprise includes SSO and audit log export.',
    'The refund window is 14 days.',
    'API integration requires a workspace token.',
  ].join('\n');
  const hit = {
    sourceType: 'uploaded_material',
    sourceId: 'mat_product_faq',
    chunkId: 101,
    score: 0.94,
    title: 'CueUp Product FAQ.md',
    text: faqText,
    parentText: faqText,
    fileHash: 'faq_hash_v1',
    materialUpdatedAt: '2026-07-06T00:00:00.000Z',
  };

  const { text: context } = formatUploadedMaterialContext([hit]);
  const citation = buildUploadedMaterialCitation(hit);
  const traceSummary = {
    sourceStatus: {
      ragAttempted: true,
      ragReady: true,
      embeddingReady: true,
      uploadedMaterialHitCount: 1,
      citationCount: 1,
    },
    citations: [citation],
  };

  assert.match(context, /CueUp Enterprise includes SSO and audit log export/);
  assert.match(context, /The refund window is 14 days/);
  assert.match(context, /API integration requires a workspace token/);
  assert.doesNotMatch(context, /30 days refund|30-day refund/i);
  assert.equal(traceSummary.sourceStatus.uploadedMaterialHitCount > 0, true);
  assert.equal(traceSummary.citations[0].title, 'CueUp Product FAQ.md');
});
