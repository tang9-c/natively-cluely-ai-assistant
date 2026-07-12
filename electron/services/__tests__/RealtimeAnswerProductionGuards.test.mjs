import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('generate-what-to-say gates uploaded material citations behind reference_files scope', () => {
  const source = read('electron/ipcHandlers.ts');
  const contextPrep = read('electron/services/context/WhatToSayContextPreparation.ts');
  const contribution = read('electron/services/knowledge/UploadedMaterialContextContributionService.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /const\s+providerScopes\s*=\s*SettingsManager\.getInstance\(\)\.get\('providerDataScopes'\)\s*\|\|\s*\{\}/);
  assert.match(handler, /providerScopes,/);
  assert.match(contextPrep, /scopePolicy:\s*input\.request\.providerScopes/);
  assert.match(contextPrep, /const searchQuery = modeQuery \|\| questionQuery/);
  assert.doesNotMatch(handler, /citations\.push[\s\S]{0,500}providerScopePolicy:\s*SettingsManager\.getInstance\(\)\.get\('providerDataScopes'\)/);
  assert.match(contribution, /getDeniedDataScopes\(\['reference_files'\], input\.scopePolicy\)/);
  assert.match(contribution, /context_scope_denied/);
});
