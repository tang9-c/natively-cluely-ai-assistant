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

test('fde canonical default context ships editable manufacturing deployment template', () => {
  const modeDefaults = fs.readFileSync(path.join(root, 'electron/services/ModeDefaultContexts.ts'), 'utf8');
  const fdeBlock = modeDefaults.match(/fde:\s*\[[\s\S]*?\]\.join\('\\n'\)/)?.[0] ?? '';

  assert.match(fdeBlock, /制造业 PLM \/ QMS \/ 企业 AI Agent 部署 FDE/);
  assert.match(fdeBlock, /不可承诺事项|不替客户做流程承诺|不承诺未经验证/);
  assert.match(fdeBlock, /交付边界|只读查询|不自动创建|不自动.*写入/);
  assert.match(fdeBlock, /已知风险|待验证假设|假设.*验证/);
  assert.doesNotMatch(fdeBlock, /优先澄清客户工作流、系统边界、数据流、权限、安全合规、上线约束和成功标准/);
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
