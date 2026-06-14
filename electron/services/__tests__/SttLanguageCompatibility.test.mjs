import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadModule() {
  const modPath = path.join(root, 'dist-electron/electron/audio/sttLanguageCompatibility.js');
  return import(pathToFileURL(modPath).href);
}

test('local-whisper multilingual model honors explicit Chinese selection', async () => {
  const { resolveSttLanguageCompatibility } = await loadModule();

  const result = resolveSttLanguageCompatibility({
    provider: 'local-whisper',
    requestedLanguageKey: 'chinese',
    localWhisper: {
      enabled: false,
      globalModelId: 'Xenova/whisper-base',
      micModelId: '',
      systemModelId: '',
    },
  });

  assert.equal(result.willHonorSelection, true);
  assert.equal(result.effectiveLanguageKey, 'chinese');
  assert.equal(result.reasonCode, 'SUPPORTED');
});

test('local-whisper English-only model warns that explicit Chinese selection will not be honored', async () => {
  const { resolveSttLanguageCompatibility } = await loadModule();

  const result = resolveSttLanguageCompatibility({
    provider: 'local-whisper',
    requestedLanguageKey: 'chinese',
    localWhisper: {
      enabled: false,
      globalModelId: 'Xenova/whisper-base.en',
      micModelId: '',
      systemModelId: '',
    },
  });

  assert.equal(result.willHonorSelection, false);
  assert.equal(result.effectiveLanguageKey, 'english-us');
  assert.equal(result.reasonCode, 'MODEL_ENGLISH_ONLY');
  assert.match(result.message, /Chinese/i);
});

test('auto on non-natively providers is explained as an English fallback instead of silently treated as supported', async () => {
  const { resolveSttLanguageCompatibility } = await loadModule();

  const result = resolveSttLanguageCompatibility({
    provider: 'google',
    requestedLanguageKey: 'auto',
  });

  assert.equal(result.willHonorSelection, false);
  assert.equal(result.effectiveLanguageKey, 'english-us');
  assert.equal(result.reasonCode, 'AUTO_NORMALIZED_TO_ENGLISH');
});
