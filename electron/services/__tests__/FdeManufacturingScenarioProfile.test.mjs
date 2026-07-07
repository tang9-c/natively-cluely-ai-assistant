import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

test('fde canonical default context carries manufacturing and AI Agent guardrails', () => {
  const modeDefaults = fs.readFileSync(path.join(root, 'electron/services/ModeDefaultContexts.ts'), 'utf8');
  const fdeBlock = modeDefaults.match(/fde:\s*\[[\s\S]*?\]\.join\('\\n'\)/)?.[0] ?? '';

  assert.match(fdeBlock, /PLM|BOM|ECR|ECO|ECN|图纸|版本/);
  assert.match(fdeBlock, /QMS|CAPA|NCR|8D|审计|追溯/);
  assert.match(fdeBlock, /AI Agent|智能体|人机协同|人工确认/);
  assert.match(fdeBlock, /只读|read-only|不替.*写入|不可自动写入/i);
});

test('ModesManager and DatabaseManager use the same canonical FDE default context source', () => {
  const modesManager = fs.readFileSync(path.join(root, 'electron/services/ModesManager.ts'), 'utf8');
  const databaseManager = fs.readFileSync(path.join(root, 'electron/db/DatabaseManager.ts'), 'utf8');

  assert.match(modesManager, /from '\.\/ModeDefaultContexts'/);
  assert.match(modesManager, /getDefaultModeCustomContext\(params\.templateType\)/);
  assert.doesNotMatch(modesManager, /FDE_MANUFACTURING_CUSTOM_CONTEXT|resolveDefaultCustomContext/);

  assert.match(databaseManager, /from '\.\.\/services\/ModeDefaultContexts'/);
  assert.match(databaseManager, /getDefaultModeCustomContext\(templateType\)/);
});
