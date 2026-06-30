import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('Doubao Pro model id is centralized outside research builder logs', () => {
  const constants = read('electron/llm/DoubaoModelConstants.ts');
  const builder = read('electron/services/research/ResearchDossierBuilder.ts');

  assert.match(constants, /export const DOUBAO_PRO_MODEL = "doubao-1-5-pro-32k-250115"/);
  assert.match(constants, /export const DOUBAO_PRO_PROVIDER_LABEL = `Doubao Pro \(\$\{DOUBAO_PRO_MODEL\}\)`/);
  assert.match(builder, /DOUBAO_PRO_PROVIDER_LABEL/);
  assert.doesNotMatch(builder, /Doubao Pro \(doubao-1-5-pro-32k-250115\)/);
});
