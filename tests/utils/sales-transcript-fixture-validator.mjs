import { readFileSync } from 'node:fs';

export const SALES_INTENT_ENUM = [
  'sales_buying_signal',
  'sales_pricing_objection',
  'sales_quote_request',
  'sales_proof_request',
  'sales_technical_requirements',
  'sales_pain_discovery',
  'sales_capability_fit',
  'sales_process_integration',
  'sales_value_discovery',
  'sales_contextual_proof_discovery',
  'handle_objection',
  'seize_signal',
  'discovery_probe',
];

const KEYWORD_INTENT_HINTS = {
  sales_pain_discovery: ['不同步', 'Excel', '停线', '痛苦', '断链', '重复录入', '不一致'],
  sales_capability_fit: ['能不能', '是否适合', '可不可以', '支持', '校验'],
  sales_process_integration: ['闭环', '同步', '打通', '集成'],
  sales_value_discovery: ['周期', '良率', '审计', '返工', '效率'],
  sales_contextual_proof_discovery: ['只读', '人工确认', '类似', '案例', '制造客户'],
  sales_technical_requirements: ['API', 'SSO', 'SAML', 'OAuth', 'SOC2', '部署', '生产环境'],
  sales_proof_request: ['客户案例', 'ROI', '参考客户', '案例'],
  sales_quote_request: ['报价单', '商务条款', '多少钱', '报价', '价格页'],
  sales_pricing_objection: ['预算', '太贵', '太高', '打折', '折扣', '负担不起'],
  sales_buying_signal: ['下一步', '法务', '法律', '审核', '发合同', '准备签', '敲定'],
};

const REQUIRED_TOP_LEVEL_KEYS = [
  'id', 'title', 'language', 'total_duration_ms',
  'speakers', 'scenarios', 'segments', 'expected_intent_coverage',
];

export function validateSalesTranscriptFixture(fixturePath) {
  const errors = [];
  const warnings = [];
  const coverageReport = {};

  let raw;
  try {
    raw = readFileSync(fixturePath, 'utf8');
  } catch (e) {
    return { ok: false, errors: [`cannot read fixture: ${e.message}`], warnings, coverageReport };
  }

  let fixture;
  try {
    fixture = JSON.parse(raw);
  } catch (e) {
    return { ok: false, errors: [`invalid JSON: ${e.message}`], warnings, coverageReport };
  }

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!(key in fixture)) errors.push(`missing top-level key: ${key}`);
  }

  // speakers 唯一性 + 引用合法性
  const speakerIds = new Set();
  const validRoles = new Set(['user', 'customer', 'internal']);
  const validScenarioIds = new Set();
  for (const sp of (fixture.speakers ?? [])) {
    if (speakerIds.has(sp.id)) errors.push(`duplicate speaker id: ${sp.id}`);
    speakerIds.add(sp.id);
    if (!validRoles.has(sp.role)) errors.push(`invalid role for ${sp.id}: ${sp.role}`);
    for (const sid of (sp.scenarios ?? [])) validScenarioIds.add(sid);
  }

  // scenarios 时序 + 不重叠 + expected_intents 是合法枚举
  const scenarios = [...(fixture.scenarios ?? [])].sort((a, b) => a.start_ms - b.start_ms);
  for (let i = 0; i < scenarios.length; i++) {
    const sc = scenarios[i];
    if (i > 0 && sc.start_ms < scenarios[i - 1].end_ms) {
      errors.push(`scenario overlap: ${scenarios[i - 1].id} and ${sc.id}`);
    }
    for (const intent of (sc.expected_intents ?? [])) {
      if (!SALES_INTENT_ENUM.includes(intent)) errors.push(`unknown intent in ${sc.id}: ${intent}`);
    }
  }

  // segments 校验 + 覆盖率统计
  for (const seg of (fixture.segments ?? [])) {
    if (!speakerIds.has(seg.speaker_id)) errors.push(`segment ${seg.id}: unknown speaker ${seg.speaker_id}`);
    if (!validScenarioIds.has(seg.scenario)) errors.push(`segment ${seg.id}: unknown scenario ${seg.scenario}`);
    if (seg.start_ms >= seg.end_ms) errors.push(`segment ${seg.id}: start_ms >= end_ms`);
    if (seg.expected_intent && !SALES_INTENT_ENUM.includes(seg.expected_intent)) {
      errors.push(`segment ${seg.id}: unknown expected_intent ${seg.expected_intent}`);
    }
    if (seg.expected_intent) {
      coverageReport[seg.expected_intent] = (coverageReport[seg.expected_intent] ?? 0) + 1;
      // trigger_keywords ↔ expected_intent 配对（warning 不阻断）
      const hints = KEYWORD_INTENT_HINTS[seg.expected_intent];
      if (hints) {
        const matched = (seg.trigger_keywords ?? []).some(kw => hints.some(h => kw.includes(h) || h.includes(kw)));
        if (!matched) warnings.push(`segment ${seg.id}: trigger_keywords don't strongly match expected_intent ${seg.expected_intent}`);
      }
    }
  }

  // coverage 反向校验
  for (const [intent, required] of Object.entries(fixture.expected_intent_coverage ?? {})) {
    if (intent === 'internal_chatter_suppression') continue;
    const actual = coverageReport[intent] ?? 0;
    if (required === 0 && actual > 0) {
      errors.push(`legacy intent ${intent} should not trigger but observed ${actual}`);
    } else if (required > 0 && actual < required) {
      errors.push(`intent ${intent} coverage ${actual} < required ${required}`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, coverageReport };
}

// CLI entry: only run when invoked directly via `node validator.mjs <path>`
import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node sales-transcript-fixture-validator.mjs <fixture.json>');
    process.exit(2);
  }
  const result = validateSalesTranscriptFixture(target);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}
