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

test('CredentialsManager exposes business system source methods', () => {
  const source = read('electron/services/CredentialsManager.ts');

  assert.match(source, /businessSystemKnowledgeSources\?:/);
  assert.match(source, /businessSystemCredentials\?:/);
  assert.match(source, /saveBusinessSystemKnowledgeSource/);
  assert.match(source, /getBusinessSystemKnowledgeSourcesPublic/);
  assert.match(source, /getBusinessSystemCredentials/);
  assert.match(source, /deleteBusinessSystemKnowledgeSource/);
});

test('public business system sources return credential state without plaintext credentials', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('public getBusinessSystemKnowledgeSourcesPublic');
  const end = source.indexOf('public getBusinessSystemCredentials', start);
  const method = source.slice(start, end);

  assert.ok(start >= 0, 'public source getter should exist');
  assert.match(method, /credentialState/);
  assert.match(method, /hasApiKey/);
  assert.match(method, /hasUsername/);
  assert.match(method, /hasPassword/);
  assert.doesNotMatch(method, /apiKey\s*:/);
  assert.doesNotMatch(method, /password\s*:/);
});

test('scrubMemory clears nested business system credentials', () => {
  const source = read('electron/services/CredentialsManager.ts');
  const start = source.indexOf('public scrubMemory(): void');
  const end = source.indexOf('    // =========================================================================', start);
  const method = source.slice(start, end);

  assert.match(method, /businessSystemCredentials/);
  assert.match(method, /apiKey/);
  assert.match(method, /password/);
});
