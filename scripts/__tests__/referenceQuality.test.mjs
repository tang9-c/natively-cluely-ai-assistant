import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  calculateEditBreakdown,
  extractTimedReferenceSegments,
  selectBoundaryAlignedWindow,
} from '../stt-benchmark/referenceQuality.mjs';

test('selectBoundaryAlignedWindow uses transcript boundaries for both audio and text', () => {
  const segments = extractTimedReferenceSegments([
    '说话人 1 00:04:20窗口外内容',
    '说话人 1 00:04:50第一段',
    '说话人 2 00:05:20第二段',
    '说话人 1 00:06:10窗口外内容',
  ].join('\n'));

  const result = selectBoundaryAlignedWindow(segments, {
    requestedStartSec: 270,
    requestedDurationSec: 90,
    maxStartShiftSec: 30,
    minDurationRatio: 0.75,
    maxDurationRatio: 1.25,
  });

  assert.equal(result.status, 'aligned');
  assert.equal(result.actualStartSec, 290);
  assert.equal(result.actualEndSec, 370);
  assert.equal(result.actualDurationSec, 80);
  assert.equal(result.leftOverhangSec, 0);
  assert.equal(result.rightOverhangSec, 0);
  assert.equal(result.text, '第一段 第二段');
});

test('selectBoundaryAlignedWindow rejects a request with no trustworthy boundary pair', () => {
  const segments = extractTimedReferenceSegments([
    '说话人 1 00:04:20很长的一段',
    '说话人 1 00:06:50下一段',
  ].join('\n'));

  const result = selectBoundaryAlignedWindow(segments, {
    requestedStartSec: 300,
    requestedDurationSec: 60,
    maxStartShiftSec: 30,
    minDurationRatio: 0.75,
    maxDurationRatio: 1.25,
  });

  assert.equal(result.status, 'invalid_boundary_window');
  assert.equal(result.text, '');
});

test('calculateEditBreakdown distinguishes deletions from substitutions', () => {
  assert.deepEqual(calculateEditBreakdown('质量流程', '质量'), {
    distance: 2,
    insertions: 0,
    deletions: 2,
    substitutions: 0,
  });
});
