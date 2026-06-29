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

function safeHandleBlock(source, channel) {
  const marker = new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`);
  const match = source.match(marker);
  assert.ok(match && match.index !== undefined, `${channel} handler should exist`);
  const start = match.index;
  const next = source.slice(start + 1).search(/safeHandle\(\s*['"]/);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test('Doubao test connection IPC uses network classifier and safe diagnostics', () => {
  const source = read('electron/ipcHandlers.ts');
  const llm = safeHandleBlock(source, 'test-llm-connection');
  const stt = source.slice(source.indexOf('const runSttConnectionTest'), source.indexOf("safeHandle(\n    'test-stt-connection'"));

  assert.match(source, /networkErrorClassifier/);
  assert.match(llm, /classifyNetworkError/);
  assert.match(llm, /toSafeNetworkDiagnostic/);
  assert.match(stt, /classifyNetworkError/);
  assert.match(stt, /toSafeNetworkDiagnostic/);
});

test('Doubao model fetching does not log raw axios errors', () => {
  const source = read('electron/ipcHandlers.ts');
  const block = safeHandleBlock(source, 'fetch-provider-models');

  assert.match(block, /toSafeNetworkDiagnostic/);
  assert.doesNotMatch(block, /console\.error\([^;\n]*,\s*error\s*\)/);
  assert.doesNotMatch(block, /console\.error\([^;\n]*,\s*err\s*\)/);
});

test('Doubao AUC test logging does not include API key prefixes or raw headers', () => {
  const source = read('electron/ipcHandlers.ts');

  assert.doesNotMatch(source, /apiKey\.substring\(0,\s*8\)/);
  assert.doesNotMatch(source, /apiKey\.slice\(0,\s*8\)/);
  assert.doesNotMatch(source, /X-Api-Key prefix/);
  assert.doesNotMatch(
    source,
    /Doubao AUC test response:[\s\S]{0,220}headers:\s*response\.headers/
  );
  assert.doesNotMatch(source, /Doubao AUC test detailed error:[\s\S]{0,220}headers:\s*testErr\?\.response\?\.headers/);
});
