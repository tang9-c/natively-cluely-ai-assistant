import assert from 'node:assert/strict';
import test from 'node:test';

const helper = await import('../../../dist-electron/electron/audio/SttSegmentation.js');

test('buildSttSegmentPlan builds bounded overlap segments', () => {
  const plan = helper.buildSttSegmentPlan({
    mode: 'overlap',
    sourceStartSec: 300,
    sourceDurationSec: 25,
    segmentDurationSec: 10,
    overlapSec: 2,
    preRollSec: 3,
    postRollSec: 4,
  });

  assert.equal(plan.mode, 'overlap');
  assert.equal(plan.segments.length, 4);
  assert.deepEqual(
    plan.segments.map((segment) => ({
      startSec: segment.startSec,
      durationSec: segment.durationSec,
      audioStartSec: segment.audioStartSec,
      audioDurationSec: segment.audioDurationSec,
      overlapBeforeSec: segment.overlapBeforeSec,
      overlapAfterSec: segment.overlapAfterSec,
    })),
    [
      { startSec: 300, durationSec: 10, audioStartSec: 300, audioDurationSec: 14, overlapBeforeSec: 0, overlapAfterSec: 2 },
      { startSec: 308, durationSec: 10, audioStartSec: 305, audioDurationSec: 17, overlapBeforeSec: 2, overlapAfterSec: 2 },
      { startSec: 316, durationSec: 9, audioStartSec: 313, audioDurationSec: 12, overlapBeforeSec: 2, overlapAfterSec: 0 },
      { startSec: 324, durationSec: 1, audioStartSec: 321, audioDurationSec: 4, overlapBeforeSec: 2, overlapAfterSec: 0 },
    ],
  );
});

test('dedupeOverlappedTranscript removes duplicated overlap text', () => {
  assert.equal(
    helper.dedupeOverlappedTranscript([
      '我们先看 MES 供应商的流程',
      '供应商的流程还有图纸审批',
      '图纸审批需要追溯',
    ]),
    '我们先看 MES 供应商的流程还有图纸审批需要追溯',
  );
});

test('buildSegmentationDiagnostics reports duplicate removal and boundary warning', () => {
  const diagnostics = helper.buildSegmentationDiagnostics({
    mode: 'overlap',
    overlapSec: 2,
    rawText: '功能功能功能',
    dedupedText: '功能',
    segmentCount: 3,
    failedSegmentCount: 0,
  });

  assert.equal(diagnostics.rawChars, 6);
  assert.equal(diagnostics.dedupedChars, 2);
  assert.equal(diagnostics.removedDuplicateChars, 4);
  assert.equal(diagnostics.suspectedBoundaryLoss, false);
  assert.deepEqual(diagnostics.warnings, ['dedupe_removed_more_than_half_raw_text']);
});

test('buildSttSegmentPlan rejects invalid overlap', () => {
  assert.throws(
    () => helper.buildSttSegmentPlan({
      mode: 'overlap',
      sourceStartSec: 0,
      sourceDurationSec: 30,
      segmentDurationSec: 10,
      overlapSec: 10,
    }),
    /overlapSec must be smaller than segmentDurationSec/,
  );
});
