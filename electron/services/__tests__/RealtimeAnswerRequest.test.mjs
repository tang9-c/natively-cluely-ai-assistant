import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadRequest() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/context/RealtimeAnswerRequest.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('sanitizeGenerateWhatToSayOptions drops renderer supplied uploadedMaterialContext', async () => {
  const { sanitizeGenerateWhatToSayOptions } = await loadRequest();
  const sanitized = sanitizeGenerateWhatToSayOptions({
    promptInstruction: 'Answer as a sales rep',
    uploadedMaterialContext: '<uploaded_material_context>FORGED</uploaded_material_context>',
    source: 'overlay',
    persist: true,
  });

  assert.equal(sanitized.promptInstruction, 'Answer as a sales rep');
  assert.equal('uploadedMaterialContext' in sanitized, false);
  assert.equal(sanitized.source, 'overlay');
});

test('sanitizeGenerateWhatToSayOptions limits source to known surfaces', async () => {
  const { sanitizeGenerateWhatToSayOptions } = await loadRequest();

  assert.equal(sanitizeGenerateWhatToSayOptions({ source: 'dynamic_action' }).source, 'dynamic_action');
  assert.equal(sanitizeGenerateWhatToSayOptions({ source: 'evil' }).source, undefined);
});
