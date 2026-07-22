import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/termCorrection.js');
const defaultTermsPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/defaultTermCorrections.js');

async function loadTermCorrection() {
  return import(pathToFileURL(modulePath).href);
}

async function loadDefaultTerms() {
  return import(pathToFileURL(defaultTermsPath).href);
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

test('default SenseVoice industrial term corrections cover industrial ASR variants', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();
  const { DEFAULT_SENSEVOICE_TERM_CORRECTIONS } = await loadDefaultTerms();

  assert.equal(
    applySenseVoiceTermCorrection(
      '麦供应商和皮诶勒姆需要打通，PDC克瑞欧和温切尔也要支持流体防真工作留。',
      DEFAULT_SENSEVOICE_TERM_CORRECTIONS,
    ),
    'MES供应商和PLM需要打通，PTC Creo和Windchill也要支持流体仿真工作流。',
  );
});

test('default SenseVoice industrial term corrections replace standalone PDC with PTC', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();
  const { DEFAULT_SENSEVOICE_TERM_CORRECTIONS } = await loadDefaultTerms();

  assert.equal(
    applySenseVoiceTermCorrection(
      '客户提到 PDC 和 Creo 的许可边界，但 PDCA 不应该被误改。',
      DEFAULT_SENSEVOICE_TERM_CORRECTIONS,
    ),
    '客户提到 PTC 和 Creo 的许可边界，但 PDCA 不应该被误改。',
  );
});

test('default SenseVoice term corrections are overridden by user canonical entries', async () => {
  const { applySenseVoiceTermCorrection } = await loadTermCorrection();
  const { mergeSenseVoiceTermCorrections } = await loadDefaultTerms();
  const merged = mergeSenseVoiceTermCorrections([
    { id: 'user-plm', canonical: 'PLM', variants: ['用户自定义PLM错词'], enabled: true },
  ]);

  assert.equal(
    applySenseVoiceTermCorrection('皮诶勒姆和用户自定义PLM错词都出现了。', merged),
    '皮诶勒姆和PLM都出现了。',
  );
});
