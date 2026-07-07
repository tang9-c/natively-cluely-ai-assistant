import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

async function loadPlanner() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/business-system/windchill/WindchillQueryPlanner.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('plans part search by number', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const plan = planWindchillQuery({ query: '查一下 Windchill 里的 PRT-001 状态' });

  assert.equal(plan.kind, 'readonly_plan');
  assert.equal(plan.intent, 'part_search');
  assert.deepEqual(plan.calls, [{ toolName: 'part_search', arguments: { number: 'PRT-001', limit: 5 }, resultKey: 'partSearch' }]);
});

test('plans BOM lookup as search then structure', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const plan = planWindchillQuery({ query: '查 PRT-001 的 BOM 结构' });

  assert.equal(plan.kind, 'readonly_plan');
  assert.equal(plan.intent, 'part_structure');
  assert.equal(plan.calls.length, 2);
  assert.equal(plan.calls[0].toolName, 'part_search');
  assert.equal(plan.calls[1].toolName, 'part_get_structure');
  assert.equal(plan.calls[1].argumentsFrom, 'partSearch:firstId');
});

test('plans where-used lookup from recent context anchor', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const plan = planWindchillQuery({
    query: '这个物料用在哪',
    recentContext: '客户刚才问 PRT-002 是否已经发布。',
  });

  assert.equal(plan.kind, 'readonly_plan');
  assert.equal(plan.intent, 'part_where_used');
  assert.equal(plan.calls[0].arguments.number, 'PRT-002');
  assert.equal(plan.calls[1].toolName, 'part_get_where_used');
});

test('plans change lookup for ECN number', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const plan = planWindchillQuery({ query: '查一下 ECN-123 的 affected objects' });

  assert.equal(plan.kind, 'readonly_plan');
  assert.equal(plan.intent, 'change_affected_objects');
  assert.equal(plan.calls[0].toolName, 'change_search');
  assert.equal(plan.calls[1].toolName, 'change_get_affected_objects');
});

test('rejects write operations without MCP tool call', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const plan = planWindchillQuery({ query: '帮我 approve ECN-123' });

  assert.equal(plan.kind, 'unsupported_operation');
  assert.match(plan.reason, /approve|write/);
});

test('does not pass through direct MCP tool name requests', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const plan = planWindchillQuery({ query: '调用 change_approve 工具审批 ECN-123' });

  assert.equal(plan.kind, 'unsupported_operation');
});

test('returns missing anchor for vague Windchill query', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const plan = planWindchillQuery({ query: '查一下 Windchill 这个' });

  assert.equal(plan.kind, 'missing_anchor');
});

test('keeps first release plans to at most three MCP calls', async () => {
  const { planWindchillQuery } = await loadPlanner();

  const cases = [
    '查 PRT-001 的 BOM',
    '查 PRT-002 用在哪',
    '查 ECN-123 的 affected objects',
    '查一下 Windchill 里的 NCR-2024-001',
  ];

  for (const query of cases) {
    const plan = planWindchillQuery({ query });
    if (plan.kind === 'readonly_plan') {
      assert.ok(plan.calls.length <= 3, `${query} planned too many calls`);
    }
  }
});
