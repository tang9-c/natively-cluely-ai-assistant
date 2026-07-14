import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coalescerPath = path.resolve(__dirname, '../../../dist-electron/electron/TranscriptSegmentCoalescer.js');
const sessionTrackerPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');

async function loadCoalescer() {
  return import(pathToFileURL(coalescerPath).href);
}

async function loadSessionTracker() {
  return import(pathToFileURL(sessionTrackerPath).href);
}

function segment(overrides = {}) {
  return {
    speaker: 'interviewer',
    text: '整体上的',
    timestamp: 1000,
    final: true,
    confidence: 0.9,
    ...overrides,
  };
}

describe('TranscriptSegmentCoalescer', () => {
  test('merges adjacent final fragments from the same speaker', async () => {
    const { TranscriptSegmentCoalescer } = await loadCoalescer();
    const coalescer = new TranscriptSegmentCoalescer({ maxGapMs: 1200, maxMergedChars: 180 });

    const result = coalescer.tryMerge(
      segment({ text: '整体上的', timestamp: 1000, startTimestampMs: 1000, endTimestampMs: 1300 }),
      segment({ text: '解决方案我们其实分几层', timestamp: 1800, startTimestampMs: 1800, endTimestampMs: 2400 }),
    );

    assert.equal(result.merged, true);
    assert.equal(result.segment.text, '整体上的解决方案我们其实分几层');
    assert.equal(result.segment.coalescedFromCount, 2);
    assert.equal(result.segment.coalescedProvider, 'post_stt');
    assert.equal(result.segment.startTimestampMs, 1000);
    assert.equal(result.segment.endTimestampMs, 2400);
  });

  test('does not merge across speaker, hard sentence boundary, or long gap', async () => {
    const { TranscriptSegmentCoalescer } = await loadCoalescer();
    const coalescer = new TranscriptSegmentCoalescer({ maxGapMs: 1200, maxMergedChars: 180 });

    assert.equal(
      coalescer.tryMerge(segment(), segment({ speaker: 'user', text: '下一句', timestamp: 1300 })).merged,
      false,
    );
    assert.equal(
      coalescer.tryMerge(segment({ text: '这个已经说完了。' }), segment({ text: '下一句', timestamp: 1300 })).merged,
      false,
    );
    assert.equal(
      coalescer.tryMerge(segment({ endTimestampMs: 1000 }), segment({ text: '下一句', startTimestampMs: 2600, timestamp: 2600 })).merged,
      false,
    );
  });

  test('SessionTracker persists merged final transcript for context and meeting save', async () => {
    const { SessionTracker } = await loadSessionTracker();
    const tracker = new SessionTracker();
    const now = Date.now();

    tracker.handleTranscript(segment({ text: '我们做的事情是什么呢', timestamp: now }));
    tracker.handleTranscript(segment({ text: '把 KPI 里面的陈述搞清楚', timestamp: now + 700 }));

    const transcript = tracker.getFullTranscript();
    const context = tracker.getContext(120);

    assert.equal(transcript.length, 1);
    assert.equal(transcript[0].text, '我们做的事情是什么呢把 KPI 里面的陈述搞清楚');
    assert.equal(transcript[0].coalescedFromCount, 2);
    assert.equal(context.length, 1);
    assert.equal(context[0].text, transcript[0].text);
  });
});
