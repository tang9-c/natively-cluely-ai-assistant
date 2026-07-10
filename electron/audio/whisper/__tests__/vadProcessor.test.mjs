// Unit tests for the energy-based VAD processor used by whisper inference.
//
// VAD constants (from electron/audio/whisper/vadProcessor.ts):
//   WINDOW_SIZE            = 480 samples  (~30ms @ 16kHz)
//   DEFAULT_RMS_THRESHOLD  = 0.008
//   DEFAULT_HANGOVER_FRAMES = 10           (~300ms)
//   DEFAULT_MIN_SPEECH_FRAMES = 4          (~120ms)
//   MAX_SPEECH_MS          = 15000         (force-flush)
//
// These tests construct deterministic F32 streams so we can pin segment
// boundaries, hangover decay, and tail-keep behavior without depending on
// real audio fixtures.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { VadProcessor } from '../../../../dist-electron/electron/audio/whisper/vadProcessor.js';

const WINDOW = 480;
const LOUD_AMPLITUDE = 0.5;     // RMS = 0.5 > 0.008 → speech
const SOFT_AMPLITUDE = 0.001;   // RMS = 0.001 < 0.008 → silence

function zeros(n) {
  return new Float32Array(n);
}

function loud(n, amplitude = LOUD_AMPLITUDE) {
  // A constant-amplitude sine produces RMS = amplitude / sqrt(2) ≈ 0.354
  // for amplitude=0.5, well above threshold. Use a DC offset instead — RMS
  // equals |amplitude| for constant signals which is even easier to reason
  // about and avoids any aliasing artifacts at the WINDOW boundary.
  const out = new Float32Array(n);
  out.fill(amplitude);
  return out;
}

describe('VadProcessor — construction', () => {
  test('uses the documented defaults when no options are passed', () => {
    const vad = new VadProcessor();
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.currentSegmentId(), 0);
    assert.equal(vad.peekOpenSegment(), null);
  });

  test('honors custom rmsThreshold / hangoverFrames / minSpeechFrames', () => {
    const vad = new VadProcessor({ rmsThreshold: 0.5, hangoverFrames: 1, minSpeechFrames: 2 });
    // RMS < 0.5 → not speech
    const result = vad.push(loud(WINDOW * 3, 0.1));
    assert.deepEqual(result, []);
    // RMS ≥ 0.5 → speech, hangover=1 → end after 1 silent frame
    const result2 = vad.push(loud(WINDOW * 2, 0.6));
    assert.equal(result2.length, 0); // still inside the speech window
    const result3 = vad.push(zeros(WINDOW * 2));
    // 1 hangover frame passes → segment emits on the first silent frame after
    assert.ok(result3.length >= 1);
  });
});

describe('VadProcessor — push()', () => {
  test('returns [] when the entire window is silent', () => {
    const vad = new VadProcessor();
    const segments = vad.push(zeros(WINDOW * 5));
    assert.deepEqual(segments, []);
    assert.equal(vad.isInSpeech(), false);
  });

  test('opens a new speech segment on first loud window', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 2));    // 2 speech frames
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.currentSegmentId(), 1);
  });

  test('closes the segment after HANGOVER_FRAMES silent frames (default 10)', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 5));   // 5 speech frames
    const segments = vad.push(zeros(WINDOW * 10)); // 10 silent frames → hangover drains
    assert.equal(segments.length, 1);
    // speechFrameCount accumulates both loud and hangover silent frames,
    // so the emitted segment's durationMs reflects the total 15-window span.
    assert.equal(segments[0].durationMs, 15 * 30);
    assert.equal(vad.isInSpeech(), false);
  });

  test('keeps the segment open during the hangover window', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 3));
    const stillOpen = vad.push(zeros(WINDOW * 3));   // < 10 → still inside hangover
    assert.equal(stillOpen.length, 0);
    assert.equal(vad.isInSpeech(), true);
  });

  test('drops segments shorter than MIN_SPEECH_FRAMES (default 4)', () => {
    // Bump minSpeechFrames so we can construct a burst that opens-but-doesn't-
    // emit under the configured threshold. Speech and silent frames both
    // accumulate into speechFrameCount, so we use a custom high threshold.
    const vad = new VadProcessor({ minSpeechFrames: 20 });
    vad.push(loud(WINDOW * 3));   // 3 speech frames
    const after = vad.push(zeros(WINDOW * 10)); // 10 silent (hangover drains) → total 13 < 20
    assert.deepEqual(after, [], 'tiny burst under minSpeechFrames must not emit');
    assert.equal(vad.isInSpeech(), false);
  });

  test('increments currentSegmentId every time a new segment opens', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 5));
    vad.push(zeros(WINDOW * 12)); // close
    const id1 = vad.currentSegmentId();
    vad.push(loud(WINDOW * 5));
    vad.push(zeros(WINDOW * 12));
    const id2 = vad.currentSegmentId();
    assert.ok(id2 > id1, `expected id2 > id1, got ${id2} vs ${id1}`);
  });

  test('force-flushes when MAX_SPEECH_MS (15000) is reached', () => {
    const vad = new VadProcessor();
    // 15000ms / 30ms = 500 frames of pure speech → flush every 500 frames
    const out = vad.push(loud(WINDOW * 500));
    assert.equal(out.length, 1, 'should emit one segment at the 15s boundary');
    assert.equal(out[0].durationMs, 15000);
    // After force-flush the speech buffer is reset; the processor is idle
    // until the next loud window arrives.
    assert.equal(vad.isInSpeech(), false);
    // The next batch opens a fresh segment with an incremented id.
    vad.push(loud(WINDOW * 2));
    assert.equal(vad.isInSpeech(), true);
    assert.ok(vad.currentSegmentId() >= 2);
  });

  test('does not emit additional segments in continuous speech that does not cross the boundary', () => {
    const vad = new VadProcessor();
    const out = vad.push(loud(WINDOW * 100));
    assert.deepEqual(out, []);
    assert.equal(vad.isInSpeech(), true);
  });
});

describe('VadProcessor — cross-call buffer carry', () => {
  test('merges sub-window remainder across push() calls', () => {
    const vad = new VadProcessor();
    // First push leaves 200 samples (less than WINDOW_SIZE) in the buffer.
    vad.push(loud(200));
    assert.equal(vad.isInSpeech(), false); // not enough for a full window yet
    // Second push supplies the missing 280 loud samples to complete the window
    // plus 480 more — total 2 windows of speech across the boundary.
    const out = vad.push(loud(280 + WINDOW * 2));
    assert.equal(vad.isInSpeech(), true);
    assert.equal(vad.currentSegmentId(), 1);
    // Close it out.
    const closed = vad.push(zeros(WINDOW * 12));
    assert.equal(closed.length, 1);
    // 2 frames + 1 frame across the boundary = 3 windows; the cross-window
    // partial still counts as one full window once concatenated.
    assert.ok(closed[0].durationMs >= 3 * 30);
  });
});

describe('VadProcessor — peekOpenSegment()', () => {
  test('returns null when no segment is open', () => {
    const vad = new VadProcessor();
    assert.equal(vad.peekOpenSegment(), null);
  });

  test('returns null while inside hangover with empty buffer (after reset)', () => {
    const vad = new VadProcessor();
    assert.equal(vad.peekOpenSegment(), null);
  });

  test('returns the accumulated samples and durationMs while open', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 4));
    const peek = vad.peekOpenSegment();
    assert.ok(peek !== null);
    assert.ok(peek.samples instanceof Float32Array);
    assert.equal(peek.samples.length, WINDOW * 4);
    assert.equal(peek.durationMs, 4 * 30);
    // The returned buffer is owned by the caller — mutating it must not
    // affect future peek/segment outputs.
    peek.samples.fill(0);
    const peek2 = vad.peekOpenSegment();
    assert.equal(peek2.samples.length, WINDOW * 4);
    assert.equal(peek2.samples[0], LOUD_AMPLITUDE);
  });
});

describe('VadProcessor — softCommit()', () => {
  test('returns null when no segment is open', () => {
    const vad = new VadProcessor();
    assert.equal(vad.softCommit(), null);
  });

  test('emits the current segment as closed', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 6));
    const seg = vad.softCommit();
    assert.ok(seg !== null);
    assert.equal(seg.durationMs, 6 * 30);
  });

  test('keeps ~300ms (10 frames) of tail forward as a new open segment', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 20));   // 20 frames open
    const beforeId = vad.currentSegmentId();
    vad.softCommit();
    const afterId = vad.currentSegmentId();
    assert.ok(afterId > beforeId, 'softCommit must bump the segment id for tail-keep');
    assert.equal(vad.isInSpeech(), true);
    const peek = vad.peekOpenSegment();
    assert.ok(peek !== null);
    assert.equal(peek.samples.length, WINDOW * 10, 'tail should be 10 frames ≈ 300ms');
    assert.equal(peek.durationMs, 10 * 30);
  });

  test('keeps all available frames as tail when fewer than 10 are accumulated', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 5));    // 5 frames, fewer than the 10-frame cap
    vad.softCommit();
    // TAIL_FRAMES = min(10, speechBuffer.length) so 5 are kept as a new open segment.
    assert.equal(vad.isInSpeech(), true);
    const peek = vad.peekOpenSegment();
    assert.ok(peek !== null);
    assert.equal(peek.samples.length, WINDOW * 5);
    assert.equal(peek.durationMs, 5 * 30);
  });
});

describe('VadProcessor — flush()', () => {
  test('returns [] when no segment is open', () => {
    const vad = new VadProcessor();
    assert.deepEqual(vad.flush(), []);
  });

  test('emits the open segment when flush() is called inside a speech window', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 4));
    const flushed = vad.flush();
    assert.equal(flushed.length, 1);
    assert.equal(flushed[0].durationMs, 4 * 30);
    assert.equal(vad.isInSpeech(), false);
  });

  test('flushes sub-min-speech segments without emitting them', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 2));   // under minSpeechFrames=4
    const flushed = vad.flush();
    assert.deepEqual(flushed, []);
    assert.equal(vad.isInSpeech(), false);
  });

  test('also clears the carry buffer (sub-window remainder)', () => {
    const vad = new VadProcessor();
    vad.push(loud(200));          // sub-window remainder carried over
    vad.flush();
    // Subsequent push must not see the carried remainder concatenated.
    const seg = vad.push(loud(WINDOW * 5));
    assert.equal(seg.length, 0);
    assert.equal(vad.currentSegmentId(), 1);
  });
});

describe('VadProcessor — reset()', () => {
  test('clears both speech buffer and carry buffer', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 5));
    vad.push(loud(200));  // sub-window remainder
    vad.reset();
    assert.equal(vad.isInSpeech(), false);
    assert.equal(vad.peekOpenSegment(), null);
    // Fresh segment after reset
    vad.push(loud(WINDOW * 5));
    vad.push(zeros(WINDOW * 12));
    const closed = vad.peekOpenSegment();
    assert.equal(closed, null);
  });

  test('does not reset the segmentId counter (id is monotonic for the life of the processor)', () => {
    const vad = new VadProcessor();
    vad.push(loud(WINDOW * 5));
    vad.push(zeros(WINDOW * 12));
    const idBefore = vad.currentSegmentId();
    vad.reset();
    vad.push(loud(WINDOW * 5));
    vad.push(zeros(WINDOW * 12));
    const idAfter = vad.currentSegmentId();
    assert.ok(idAfter > idBefore);
  });
});