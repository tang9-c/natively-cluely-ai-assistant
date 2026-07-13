import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-dynamic-action-metrics-'));
}

test('dynamic action metrics CLI reads product, replay, and telemetry reports instead of mock data', () => {
  const reportDir = tempDir();
  fs.writeFileSync(path.join(reportDir, 'product-report.json'), JSON.stringify({
    totalFixtures: 2,
    results: [
      { fixtureId: 's1', actionType: 'pricing_objection', shouldEmit: true, emitted: true, actionTypeMatched: true, outputTypeMatched: true },
      { fixtureId: 's2', actionType: 'pricing_objection', shouldEmit: true, emitted: false, actionTypeMatched: false, outputTypeMatched: false },
    ],
  }), 'utf8');
  fs.writeFileSync(path.join(reportDir, 'replay-report.json'), JSON.stringify({
    totalEntries: 9,
    skippedEntries: 9,
    failedEntries: 0,
    passedEntries: 0,
    environmentStatus: 'blocked_missing_credentials',
    assetCoverage: {
      requiredReal: { sales: 15, fde: 10, 'team-meet': 5 },
      availableReal: { sales: 0, fde: 0, 'team-meet': 0 },
      availableSynthetic: { sales: 3, fde: 2, 'team-meet': 1 },
      blockedReal: { sales: 15, fde: 10, 'team-meet': 5 },
    },
    entries: [{
      id: 'continuation-positive',
      status: 'passed',
      continuation: {
        fixtureId: 'c1',
        shouldEmit: true,
        initialActionCompleted: true,
        plannerCalls: 1,
        plannerCallsWithoutPending: 0,
        parentActionId: 'p1',
        childActionId: 'c1',
        derivedActionEmitted: true,
        duplicateDerivedActions: 0,
        unsafeVisibleAnswerCount: 0,
        finalTurnToDerivedCardMs: 100,
        visibleAnswerKind: 'generated',
        postCallCarryover: true,
        passed: true
      }
    }],
  }), 'utf8');
  fs.writeFileSync(
    path.join(reportDir, 'telemetry.jsonl'),
    '{"name":"dynamic_action_shown","timestamp":"2026-07-10T00:00:00.000Z","modeId":"sales","properties":{"actionType":"pricing_objection","latencyKind":"final_transcript_to_card_shown"},"durationMs":42}\n',
    'utf8',
  );

  const result = spawnSync(process.execPath, ['scripts/run-dynamic-actions-metrics.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DYNAMIC_ACTIONS_REPORT_DIR: reportDir },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const summary = JSON.parse(fs.readFileSync(path.join(reportDir, 'metrics-report.json'), 'utf8'));
  assert.equal(summary.falsePositiveMissByAction.pricing_objection.recall, 0.5);
  assert.equal(summary.latency.finalTranscriptToCardShown.averageMs, 42);
  assert.equal(summary.environmentStatus, 'blocked_missing_credentials');
  assert.equal(summary.assetCoverage.availableSynthetic.sales, 3);
  assert.deepEqual(summary.continuationGateFailures, []);
});

test('dynamic action metrics CLI fails when required product or replay reports are missing', () => {
  const reportDir = tempDir();
  const result = spawnSync(process.execPath, ['scripts/run-dynamic-actions-metrics.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, DYNAMIC_ACTIONS_REPORT_DIR: reportDir },
    encoding: 'utf8',
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing required dynamic action QA report/);
});
