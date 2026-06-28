import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('global fast response toggle runtime surface is removed', () => {
  const llmHelper = read('electron/LLMHelper.ts');
  const preload = read('electron/preload.ts');
  const electronTypes = read('src/types/electron.d.ts');
  const legacyState = ['groq', 'Fast', 'Text', 'Mode'].join('');
  const legacyBodyFlag = ['fast', '_', 'mode'].join('');
  const legacyIpc = ['get', '-groq', '-fast', '-text', '-mode'].join('');
  const legacyRendererApi = ['get', 'Groq', 'Fast', 'Text', 'Mode'].join('');

  assert.equal(llmHelper.includes(legacyState), false);
  assert.equal(llmHelper.includes(legacyBodyFlag), false);
  assert.equal(preload.includes(legacyIpc), false);
  assert.equal(electronTypes.includes(legacyRendererApi), false);
});
