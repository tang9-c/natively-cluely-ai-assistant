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

  return { ok: errors.length === 0, errors, warnings, coverageReport };
}
