import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildPerformanceBaselineReport,
  renderPerformanceBaselineMarkdown,
  summarizeSamples,
} from '../lib/performanceBaselineReport.mjs';

test('summarizes thirty valid samples with p50 and p95', () => {
  const summary = summarizeSamples(Array.from({ length: 30 }, (_, index) => index + 1));

  assert.deepEqual(summary, {
    sampleCount: 30,
    p50Ms: 15,
    p95Ms: 29,
    minMs: 1,
    maxMs: 30,
  });
});

test('marks metrics with no valid samples as blocked instead of inventing a value', () => {
  const report = buildPerformanceBaselineReport({
    environment: { machine: 'M1 Pro / 16GB' },
    metrics: [{ id: 'llm.first-token', unit: 'ms', samples: [], blockedReason: 'missing_credentials' }],
  });

  assert.deepEqual(report.scenarios['llm.first-token'], {
    status: 'blocked',
    unit: 'ms',
    sampleCount: 0,
    p50Ms: null,
    p95Ms: null,
    minMs: null,
    maxMs: null,
    failures: 0,
    blockedReason: 'missing_credentials',
  });
});

test('removes sensitive values from environment and metric metadata', () => {
  const report = buildPerformanceBaselineReport({
    environment: { apiKey: 'sk-secret', hardware: 'M1 Pro' },
    metrics: [{
      id: 'stt.final',
      unit: 'ms',
      samples: [10, 20],
      metadata: { transcript: 'private meeting text', provider: 'natively' },
    }],
  });

  const json = JSON.stringify(report);
  assert.doesNotMatch(json, /sk-secret|private meeting text/);
  assert.equal(report.environment.apiKey, '[REDACTED]');
  assert.equal(report.scenarios['stt.final'].metadata.transcript, '[REMOVED]');
});

test('renders blocked metrics explicitly in the human-readable report', () => {
  const markdown = renderPerformanceBaselineMarkdown(buildPerformanceBaselineReport({
    environment: { hardware: 'M1 Pro / 16GB' },
    metrics: [{ id: 'app.cold-start', unit: 'ms', samples: [], blockedReason: 'runner_missing' }],
  }));

  assert.match(markdown, /\| app\.cold-start \| blocked \|/);
  assert.match(markdown, /runner_missing/);
});
