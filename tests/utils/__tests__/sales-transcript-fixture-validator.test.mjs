import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSalesTranscriptFixture } from '../sales-transcript-fixture-validator.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejects fixture missing required top-level keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validator-'));
  const file = join(dir, 'bad.json');
  writeFileSync(file, JSON.stringify({ id: 'x' }));
  const result = validateSalesTranscriptFixture(file);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('speakers')));
});

test('detects duplicate speaker ids', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validator-'));
  const file = join(dir, 'dup.json');
  writeFileSync(file, JSON.stringify({
    id: 't', title: 't', language: 'zh', total_duration_ms: 1000,
    speakers: [
      { id: 'S1', name: 'A', role: 'user', speaker_label: 'A', scenarios: ['s1'] },
      { id: 'S1', name: 'B', role: 'customer', speaker_label: 'B', scenarios: ['s1'] },
    ],
    scenarios: [{ id: 's1', title: 'x', template_type: 'sales', start_ms: 0, end_ms: 1000, expected_intents: [], expected_assists: [] }],
    segments: [{ id: 'seg-001', scenario: 's1', speaker_id: 'S1', speaker_label: 'A', start_ms: 0, end_ms: 100, text: 'hi', trigger_keywords: [], expected_intent: null, expected_assist: null }],
    expected_intent_coverage: {},
  }));
  const result = validateSalesTranscriptFixture(file);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('duplicate speaker id')));
});

test('detects scenario overlap', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validator-'));
  const file = join(dir, 'overlap.json');
  writeFileSync(file, JSON.stringify({
    id: 't', title: 't', language: 'zh', total_duration_ms: 1000,
    speakers: [{ id: 'S1', name: 'A', role: 'user', speaker_label: 'A', scenarios: ['s1'] }],
    scenarios: [
      { id: 's1', title: 'x', template_type: 'sales', start_ms: 0, end_ms: 500, expected_intents: [], expected_assists: [] },
      { id: 's2', title: 'y', template_type: 'sales', start_ms: 400, end_ms: 1000, expected_intents: [], expected_assists: [] },
    ],
    segments: [
      { id: 'seg-001', scenario: 's1', speaker_id: 'S1', speaker_label: 'A', start_ms: 0, end_ms: 100, text: 'a', trigger_keywords: [], expected_intent: null, expected_assist: null },
      { id: 'seg-002', scenario: 's2', speaker_id: 'S1', speaker_label: 'A', start_ms: 100, end_ms: 200, text: 'b', trigger_keywords: [], expected_intent: null, expected_assist: null },
    ],
    expected_intent_coverage: {},
  }));
  const result = validateSalesTranscriptFixture(file);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('overlap')));
});

test('coverage report counts intent occurrences', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validator-'));
  const file = join(dir, 'cov.json');
  writeFileSync(file, JSON.stringify({
    id: 't', title: 't', language: 'zh', total_duration_ms: 1000,
    speakers: [{ id: 'S1', name: 'A', role: 'user', speaker_label: 'A', scenarios: ['s1'] }],
    scenarios: [{ id: 's1', title: 'x', template_type: 'sales', start_ms: 0, end_ms: 1000, expected_intents: ['sales_pain_discovery'], expected_assists: ['discovery_question (pain)'] }],
    segments: [
      { id: 'seg-001', scenario: 's1', speaker_id: 'S1', speaker_label: 'A', start_ms: 0, end_ms: 100, text: 'a', trigger_keywords: ['不同步'], expected_intent: 'sales_pain_discovery', expected_assist: 'discovery_question (pain)' },
      { id: 'seg-002', scenario: 's1', speaker_id: 'S1', speaker_label: 'A', start_ms: 100, end_ms: 200, text: 'b', trigger_keywords: [], expected_intent: null, expected_assist: null },
    ],
    expected_intent_coverage: { sales_pain_discovery: 1 },
  }));
  const result = validateSalesTranscriptFixture(file);
  assert.equal(result.coverageReport.sales_pain_discovery, 1);
});
