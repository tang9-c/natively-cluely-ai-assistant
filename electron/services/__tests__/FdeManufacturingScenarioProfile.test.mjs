import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

test('fde default scenario profile speaks manufacturing PLM/QMS/AI Agent language', () => {
  const modesManager = fs.readFileSync(path.join(root, 'electron/services/ModesManager.ts'), 'utf8');
  assert.match(modesManager, /PLM|BOM|ECO|ECN/);
  assert.match(modesManager, /QMS|CAPA|NCR|8D/);
  assert.match(modesManager, /AI Agent|智能体|人机协同|人工确认/);
  assert.match(modesManager, /只读|read-only|不替.*写入/i);
});

