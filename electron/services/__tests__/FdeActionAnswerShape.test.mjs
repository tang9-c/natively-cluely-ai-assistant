import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');

test('fde agent feasibility prompt requires human confirmation and no-write boundary', () => {
  const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
  const block = detector.match(/type:\s*'fde_agent_feasibility'[\s\S]*?answerStyle:\s*\{[\s\S]*?\}/)?.[0] ?? '';
  assert.match(block, /human confirmation|人工确认/i);
  assert.match(block, /must not write|不能.*写入|read-only/i);
});

test('fde dynamic action prompt instructions use manufacturing delivery output contracts', () => {
  const detector = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionDetector.ts'), 'utf8');
  const fdeBlock = detector.match(/const FDE_TRIGGERS:[\s\S]*?export const MODE_TRIGGERS/)?.[0] ?? '';

  assert.match(fdeBlock, /manufacturing PLM \/ QMS|制造业/);
  assert.match(fdeBlock, /ECO|ECN|BOM|CAPA|NCR|8D/);
  assert.match(fdeBlock, /owner|负责人/);
  assert.match(fdeBlock, /date|日期/);
  assert.match(fdeBlock, /artifact|验证产物/);
  assert.match(fdeBlock, /customer-process risk|客户流程风险/);
  assert.match(fdeBlock, /system-permission risk|系统权限风险/);
  assert.match(fdeBlock, /AI Agent error risk|AI Agent 误判风险/);
  assert.match(fdeBlock, /human-reviewed approval-flow|人工确认.*审批流/);
});

test('fde synthesized intent actions use specialized prompt instructions', () => {
  const engine = fs.readFileSync(path.join(root, 'electron/services/dynamic-actions/DynamicActionEngine.ts'), 'utf8');

  assert.match(engine, /fdePromptInstructions|FDE_PROMPT_INSTRUCTIONS/);
  assert.match(engine, /fde_integration_check[\s\S]*PLM \/ QMS|fde_integration_check[\s\S]*制造业/);
  assert.match(engine, /fde_next_step[\s\S]*owner[\s\S]*date[\s\S]*artifact/);
  assert.doesNotMatch(engine, /You are in \$\{modeTemplateType\} mode\. Respond in Chinese first and help the user handle the detected \$\{type\} intent[\s\S]*fde_/);
});

test('fde main and tiny prompts are specialized for manufacturing PLM QMS AI Agent delivery', () => {
  const prompts = fs.readFileSync(path.join(root, 'electron/llm/prompts.ts'), 'utf8');
  const tinyPrompts = fs.readFileSync(path.join(root, 'electron/llm/tinyPrompts.ts'), 'utf8');
  const mainBlock = prompts.match(/export const MODE_FDE_PROMPT = `[\s\S]*?`\.trim\(\);/)?.[0] ?? '';
  const tinyBlock = tinyPrompts.match(/export const TINY_MODE_FDE_PROMPT = `[\s\S]*?`;/)?.[0] ?? '';

  for (const block of [mainBlock, tinyBlock]) {
    assert.match(block, /manufacturing|制造业/i);
    assert.match(block, /PLM|QMS/);
    assert.match(block, /AI Agent|企业 AI Agent|智能体/i);
    assert.match(block, /BOM|ECO|ECN|CAPA|NCR|8D/);
    assert.match(block, /read[- ]?only|只读/i);
    assert.match(block, /human confirmation|人工确认|人审/i);
    assert.match(block, /owner.*date.*artifact|owner.*artifact|负责人.*时间.*产物|负责人.*artifact/i);
  }

  assert.doesNotMatch(mainBlock, /CRM|Salesforce|HubSpot|Slack/);
  assert.doesNotMatch(tinyBlock, /CRM|Salesforce|HubSpot|Slack/);
});

test('fde agent feasibility intent maps to a checklist answer shape', () => {
  const classifier = fs.readFileSync(path.join(root, 'electron/llm/IntentClassifier.ts'), 'utf8');
  assert.match(classifier, /fde_agent_feasibility/);
  assert.match(classifier, /checklist/i);
  assert.match(classifier, /human confirmation|人工确认|只读/i);
});

test('fde agent feasibility is wired into shared intent contracts', () => {
  const shared = fs.readFileSync(path.join(root, 'electron/llm/IntentClassifierShared.ts'), 'utf8');

  assert.match(shared, /'fde_agent_feasibility'/);
  assert.match(shared, /AI Agent boundary as a checklist|checklist: what AI can suggest/i);
  assert.match(shared, /human confirmation|人工确认|只读|read-only/i);
  assert.match(shared, /automation boundaries|自动化边界/);
});

test('fde agent feasibility ships default keywords and keyword match order', () => {
  const defaults = fs.readFileSync(path.join(root, 'electron/llm/IntentKeywordDefaults.ts'), 'utf8');

  const fdeKeywordsBlock = defaults.match(/const FDE_KEYWORDS:[\s\S]*?];/);
  assert.ok(fdeKeywordsBlock, 'FDE keywords block must exist');
  assert.match(fdeKeywordsBlock[0], /intent:\s*'fde_agent_feasibility'/);
  assert.match(fdeKeywordsBlock[0], /AI Agent|automation|人工确认|只读|写回/);

  const fdeOrderBlock = defaults.match(/fde:\s*\[[^\]]+\]/);
  assert.ok(fdeOrderBlock, 'FDE intent match order must exist');
  assert.match(fdeOrderBlock[0], /'fde_agent_feasibility'/);
});
