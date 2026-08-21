import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ensureCellSamples,
  executeDiagnosticMatrix,
  parseMatrixArgs,
  resolveCellParameters,
} from '../run-qcloud-stt-diagnostics-matrix.mjs';
import { buildExperimentMatrix } from '../lib/qcloudSttDiagnostics.mjs';

function sample(index, { qualityPassed = true } = {}) {
  return {
    index,
    valid: true,
    pollRequests: 3,
    timingsMs: {
      submit: 100,
      poll: 50,
      pollWait: 500,
      providerProcessingLowerBound: 5000,
      providerProcessingUpperBound: 6000,
      parse: 2,
      submitToFinal: 6200 + index,
      finalToRenderer: 20,
      endToEnd: 6220 + index,
    },
    quality: qualityPassed
      ? { characterErrorRate: 0.2, keywordRecall: 0.9, lengthRatio: 0.95 }
      : { characterErrorRate: 0.5, keywordRecall: 0.5, lengthRatio: 0.5 },
  };
}

test('parses required matrix paths and rejects an unsupported machine label', () => {
  const options = parseMatrixArgs([
    '--machine', 'm4-16gb',
    '--audio', '/tmp/audio.wav',
    '--reference', '/tmp/reference.docx',
    '--output-dir', '/tmp/qcloud-diagnostics',
  ]);
  assert.equal(options.machine, 'm4-16gb');
  assert.equal(options.audio, '/tmp/audio.wav');
  assert.equal(options.reference, '/tmp/reference.docx');
  assert.equal(options.outputDir, '/tmp/qcloud-diagnostics');
  assert.equal(options.startSeconds, 3083);
  assert.throws(() => parseMatrixArgs(['--machine', 'intel']), /invalid_machine/);
});

test('resolves later-stage placeholders from prior winners', () => {
  const resolved = resolveCellParameters({
    id: 'vad-qcloud-current',
    segmentSeconds: '$segmentWinner',
    pollIntervalMs: '$pollWinner',
    parameterGroup: 'qcloud-current',
  }, {
    poll: { pollIntervalMs: 500 },
    segment: { segmentSeconds: 5 },
  });
  assert.equal(resolved.pollIntervalMs, 500);
  assert.equal(resolved.segmentSeconds, 5);
});

test('resume keeps existing samples and requests only the missing valid count', async () => {
  const saved = [];
  const state = {
    cell: { samples: [
      ...Array.from({ length: 7 }, (_, index) => sample(index + 1)),
      { index: 8, valid: false, failureStage: 'poll_failed' },
      { index: 9, valid: false, failureStage: 'poll_failed' },
    ] },
  };
  const requests = [];
  const result = await ensureCellSamples({
    cell: { id: 'cell', segmentSeconds: 10, pollIntervalMs: 1000, parameterGroup: 'qcloud-current' },
    targetValidSamples: 10,
    loadCell: async id => state[id],
    saveCell: async (_id, next) => saved.push(next),
    collectSamples: async (_cell, missing) => {
      requests.push(missing);
      return Array.from({ length: missing }, (_, index) => sample(index + 10));
    },
  });

  assert.deepEqual(requests, [3]);
  assert.equal(result.samples.length, 12);
  assert.equal(result.summary.validCount, 10);
  assert.equal(saved.length, 1);
});

test('runner exceptions become a sanitized failed sample', async () => {
  const result = await ensureCellSamples({
    cell: { id: 'cell', segmentSeconds: 10, pollIntervalMs: 1000, parameterGroup: 'qcloud-current' },
    targetValidSamples: 1,
    loadCell: async () => null,
    saveCell: async () => {},
    collectSamples: async () => { throw new Error('Bearer private-key transcript'); },
  });
  assert.equal(result.summary.validCount, 0);
  assert.deepEqual(result.summary.failureStages, { runner_failed: 1 });
  assert.doesNotMatch(JSON.stringify(result), /private-key|transcript/);
});

test('executes cells serially and tops every stage winner up to thirty valid samples', async () => {
  const states = new Map();
  let active = 0;
  let maxActive = 0;
  const report = await executeDiagnosticMatrix({
    matrix: buildExperimentMatrix(),
    loadCell: async id => states.get(id),
    saveCell: async (id, state) => states.set(id, state),
    collectSamples: async (_cell, missing) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      active -= 1;
      return Array.from({ length: missing }, (_, index) => sample(index + 1));
    },
  });

  assert.equal(maxActive, 1);
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.stages.map(stage => stage.status), ['completed', 'completed', 'completed']);
  assert.ok(report.stages.every(stage => stage.winner.summary.validCount === 30));
});

test('blocks dependent stages when the first stage has no quality-qualified winner', async () => {
  const states = new Map();
  const collected = [];
  const report = await executeDiagnosticMatrix({
    matrix: buildExperimentMatrix(),
    loadCell: async id => states.get(id),
    saveCell: async (id, state) => states.set(id, state),
    collectSamples: async (cell, missing) => {
      collected.push(cell.id);
      return Array.from({ length: missing }, (_, index) => sample(index + 1, { qualityPassed: false }));
    },
  });

  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedStage, 'poll');
  assert.ok(collected.every(id => id.startsWith('poll-')));
  assert.equal(report.stages.length, 1);
});

test('blocks a stage when any screening candidate lacks ten valid samples', async () => {
  const states = new Map();
  const report = await executeDiagnosticMatrix({
    matrix: buildExperimentMatrix(),
    loadCell: async id => states.get(id),
    saveCell: async (id, state) => states.set(id, state),
    collectSamples: async (cell, missing) => {
      const count = cell.id === 'poll-500' ? missing - 1 : missing;
      return Array.from({ length: count }, (_, index) => sample(index + 1));
    },
  });
  assert.equal(report.status, 'blocked');
  assert.equal(report.blockedStage, 'poll');
  assert.equal(report.stages[0].candidates.find(cell => cell.id === 'poll-500').summary.validCount, 9);
});
