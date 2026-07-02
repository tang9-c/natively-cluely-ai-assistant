import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/termCorrection.js');

async function loadTermCorrection() {
  return import(pathToFileURL(modulePath).href);
}

test('applySenseVoiceTermCorrection replaces enabled variants with canonical terms', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();

  assert.equal(
    applySenseVoiceTermCorrection('内提夫利很好用。', [
      { id: '1', canonical: 'Natively', variants: ['内提夫利'], enabled: true },
    ]),
    'Natively很好用。',
  );
});

test('applySenseVoiceTermCorrection replaces all occurrences without cascading canonical text', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();

  assert.equal(
    applySenseVoiceTermCorrection('内提夫利和内提夫利都不是 Native Lee。', [
      { id: '1', canonical: 'Native Lee', variants: ['内提夫利'], enabled: true },
      { id: '2', canonical: 'Natively', variants: ['Native Lee'], enabled: true },
    ]),
    'Native Lee和Native Lee都不是 Natively。',
  );
});

test('applySenseVoiceTermCorrection prefers longer variants first', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();

  assert.equal(
    applySenseVoiceTermCorrection('豆包语音识别今天很稳定。', [
      { id: '1', canonical: 'Doubao', variants: ['豆包'], enabled: true },
      { id: '2', canonical: 'Doubao AUC', variants: ['豆包语音识别'], enabled: true },
    ]),
    'Doubao AUC今天很稳定。',
  );
});

test('applySenseVoiceTermCorrection uses ASCII word boundaries', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();

  assert.equal(
    applySenseVoiceTermCorrection('api works, apiary stays unchanged.', [
      { id: '1', canonical: 'API', variants: ['api'], enabled: true },
    ]),
    'API works, apiary stays unchanged.',
  );
});

test('sanitizeSenseVoiceTerms filters unsafe short variants and duplicates', async () => {
  const { sanitizeSenseVoiceTerms } = await loadTermCorrection();

  assert.deepEqual(
    sanitizeSenseVoiceTerms([
      { id: 'x', canonical: ' Natively ', variants: ['内', 'AI', '内提夫利', '内提夫利'], enabled: true },
    ]),
    [{ id: 'x', canonical: 'Natively', variants: ['内提夫利'], enabled: true }],
  );
});

test('applySenseVoiceTermCorrection skips disabled terms and defaults missing enabled to true', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();

  assert.equal(
    applySenseVoiceTermCorrection('内提夫利和耐提夫利都出现了。', [
      { id: 'disabled', canonical: 'Disabled', variants: ['内提夫利'], enabled: false },
      { id: 'default', canonical: 'Natively', variants: ['耐提夫利'] },
    ]),
    '内提夫利和Natively都出现了。',
  );
});

test('sanitizeSenseVoiceTerms caps term and variant counts', async () => {
  const { sanitizeSenseVoiceTerms } = await loadTermCorrection();
  const input = Array.from({ length: 205 }, (_, index) => ({
    id: `term-${index}`,
    canonical: `Canonical ${index}`,
    variants: Array.from({ length: 25 }, (_unused, variantIndex) => `variant-${index}-${variantIndex}`),
    enabled: true,
  }));

  const terms = sanitizeSenseVoiceTerms(input);

  assert.equal(terms.length, 200);
  assert.equal(terms[0].variants.length, 20);
});

test('applySenseVoiceTermCorrection resolves equal-length same-offset ties by settings order', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();

  assert.equal(
    applySenseVoiceTermCorrection('内提夫利', [
      { id: 'first', canonical: 'First Canonical', variants: ['内提夫利'], enabled: true },
      { id: 'second', canonical: 'Second Canonical', variants: ['内提夫利'], enabled: true },
    ]),
    'First Canonical',
  );
});
