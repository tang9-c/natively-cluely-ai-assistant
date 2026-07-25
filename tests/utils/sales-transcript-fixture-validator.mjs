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
  const allSegmentStartEnds = [];
  for (const seg of (fixture.segments ?? [])) {
    if (!speakerIds.has(seg.speaker_id)) errors.push(`segment ${seg.id}: unknown speaker ${seg.speaker_id}`);
    if (!validScenarioIds.has(seg.scenario)) errors.push(`segment ${seg.id}: unknown scenario ${seg.scenario}`);
    if (seg.start_ms >= seg.end_ms) errors.push(`segment ${seg.id}: start_ms >= end_ms`);
    if (seg.expected_intent && !SALES_INTENT_ENUM.includes(seg.expected_intent)) {
      errors.push(`segment ${seg.id}: unknown expected_intent ${seg.expected_intent}`);
    }
    allSegmentStartEnds.push([seg.start_ms, seg.end_ms]);
    if (seg.expected_intent) {
      coverageReport[seg.expected_intent] = (coverageReport[seg.expected_intent] ?? 0) + 1;
    }
  }
  allSegmentStartEnds.sort((a, b) => a[0] - b[0]);

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
