import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('model capabilities use explicit QCLOUD context and input budgets', () => {
  const source = read('electron/llm/modelCapabilities.ts');

  assert.match(source, /QCLOUD_MODEL_SPECS/);
  assert.match(source, /maxInputTokens\?:\s*number/);
  assert.match(source, /maxOutputTokens\?:\s*number/);
  assert.match(source, /export function getEffectiveInputBudget/);
  assert.match(source, /Math\.min\(\s*caps\.maxInputTokens\s*\?\?\s*Number\.MAX_SAFE_INTEGER,\s*caps\.maxContextTokens - requestedOutputTokens - overheadTokens\s*\)/);
  assert.match(source, /outputBudgetTokens:\s*QCLOUD_DEFAULT_OUTPUT_TOKENS/);
  assert.match(source, /promptBudgetTokens:\s*8_000/);
  assert.match(source, /supportsImages:\s*true/);
});

