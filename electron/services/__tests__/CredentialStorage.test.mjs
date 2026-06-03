import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('CredentialsManager persists credentials as plaintext JSON', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const saveStart = source.indexOf('    private saveCredentials(): void');
  const saveEnd = source.indexOf('    private loadCredentials(): void', saveStart);
  const saveSource = source.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0, 'saveCredentials should exist');
  assert.match(saveSource, /fs\.writeFileSync/);
  assert.match(saveSource, /JSON\.stringify/);
  assert.doesNotMatch(saveSource, /safeStorage/);
  assert.doesNotMatch(saveSource, /encrypt/);
});

test('CredentialsManager loads credentials from plaintext JSON', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const loadStart = source.indexOf('    private loadCredentials(): void');
  const loadSource = source.slice(loadStart);

  assert.ok(loadStart >= 0, 'loadCredentials should exist');
  assert.match(loadSource, /fs\.readFileSync/);
  assert.match(loadSource, /JSON\.parse/);
  assert.doesNotMatch(loadSource, /safeStorage/);
  assert.doesNotMatch(loadSource, /decrypt/);
});

test('SettingsManager does not log full settings JSON', () => {
  const source = read('electron/services/SettingsManager.ts');

  assert.match(source, /Settings loaded successfully', \{ keys: Object\.keys\(this\.settings\)\.length \}/);
  assert.doesNotMatch(source, /JSON\.stringify\(this\.settings\)/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*,\s*this\.settings\s*[),]/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*,\s*parsed\s*[),]/);
});
