import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('Ollama process control defines Windows and POSIX commands', () => {
  const src = read('electron/services/OllamaProcessControl.ts');

  assert.match(src, /netstat -ano/);
  assert.match(src, /taskkill \/F \/PID/);
  assert.match(src, /lsof -t -i/);
  assert.match(src, /kill -9/);
  assert.match(src, /extractNumericPids/);
});

test('LLMHelper delegates port cleanup to OllamaProcessControl', () => {
  const src = read('electron/LLMHelper.ts');

  assert.match(src, /killProcessesOnPort/);
  assert.doesNotMatch(src, /lsof -t -i:11434/);
  assert.doesNotMatch(src, /kill -9 \$\{pid\}/);
});
