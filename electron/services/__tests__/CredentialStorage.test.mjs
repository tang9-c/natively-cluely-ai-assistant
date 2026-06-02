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

test('CredentialsManager does not persist plaintext fallback credentials when encryption is unavailable', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const saveStart = source.indexOf('    private saveCredentials(): void');
  const saveEnd = source.indexOf('    private loadCredentials(): void', saveStart);
  const saveSource = source.slice(saveStart, saveEnd);

  assert.ok(saveStart >= 0, 'saveCredentials should exist');
  assert.match(saveSource, /SecureStorage\.encryptJSON/);
  assert.doesNotMatch(source, /safeStorage/);
  assert.doesNotMatch(saveSource, /\.json'\s*\)/);
  assert.doesNotMatch(source, /kept in memory only/);
  assert.match(read('electron/services/SecureStorage.ts'), /NATIVELY:/);
});

test('CredentialsManager removes plaintext fallback files instead of loading them', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const loadStart = source.indexOf('    private loadCredentials(): void');
  const loadSource = source.slice(loadStart);

  assert.ok(loadStart >= 0, 'loadCredentials should exist');
  assert.match(loadSource, /SecureStorage\.decryptJSON<StoredCredentials>/);
  assert.doesNotMatch(loadSource, /readFileSync\(plaintextPath/);
  assert.doesNotMatch(loadSource, /JSON\.parse\(plaintextData\)/);
  assert.doesNotMatch(loadSource, /Loaded credentials from plaintext fallback/);
  assert.doesNotMatch(loadSource, /safeStorage\.decryptString/);
});

test('SettingsManager does not log full settings JSON', () => {
  const source = read('electron/services/SettingsManager.ts');

  assert.match(source, /Settings loaded successfully', \{ keys: Object\.keys\(this\.settings\)\.length \}/);
  assert.doesNotMatch(source, /JSON\.stringify\(this\.settings\)/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*,\s*this\.settings\s*[),]/);
  assert.doesNotMatch(source, /console\.(?:log|warn|error)\([^\n]*,\s*parsed\s*[),]/);
});
