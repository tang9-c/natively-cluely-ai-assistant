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
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /const\s+providerScopes\s*=\s*SettingsManager\.getInstance\(\)\.get\('providerDataScopes'\)\s*\|\|\s*\{\}/);
  assert.match(handler, /const\s+referenceFilesAllowed\s*=\s*providerScopes\.reference_files\s*!==\s*false/);
  assert.match(handler, /if\s*\(searchQuery\s*&&\s*referenceFilesAllowed\)/);
  assert.doesNotMatch(handler, /citations\.push[\s\S]{0,500}providerScopePolicy:\s*SettingsManager\.getInstance\(\)\.get\('providerDataScopes'\)/);
  assert.match(handler, /context_scope_denied/);
});
