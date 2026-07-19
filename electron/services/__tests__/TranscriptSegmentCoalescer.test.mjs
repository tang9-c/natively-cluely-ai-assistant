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

function mergeAll(coalescer, segments) {
  const merged = [];
  for (const next of segments) {
    const previous = merged[merged.length - 1];
    const result = coalescer.tryMerge(previous, next);
    if (result.merged) {
      merged[merged.length - 1] = result.segment;
    } else {
      merged.push(next);
    }
  }
  return merged;
}

describe('TranscriptSegmentCoalescer', () => {
  test('merges adjacent final fragments from the same speaker', async () => {
    const { TranscriptSegmentCoalescer } = await loadCoalescer();
    const coalescer = new TranscriptSegmentCoalescer({ maxGapMs: 1200, maxMergedChars: 320 });

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
    const coalescer = new TranscriptSegmentCoalescer({ maxGapMs: 1200, maxMergedChars: 320 });

    assert.equal(
      coalescer.tryMerge(segment(), segment({ speaker: 'user', text: '下一句', timestamp: 1300 })).merged,
      false,
    );
    assert.equal(
      coalescer.tryMerge(segment({ text: '这个已经说完了。' }), segment({ text: '下一句', timestamp: 1300 })).merged,
      false,
    );
    assert.equal(
      coalescer.tryMerge(segment({ endTimestampMs: 1000 }), segment({ text: '下一句', startTimestampMs: 4300, timestamp: 4300 })).merged,
      false,
    );
  });

  test('coalesces Mandarin breath-cut fragments into natural transcript turns', async () => {
    const { TranscriptSegmentCoalescer } = await loadCoalescer();
    const coalescer = new TranscriptSegmentCoalescer();
    const parts = [
      segment({ text: '如果', timestamp: 0, startTimestampMs: 0, endTimestampMs: 300 }),
      segment({ text: '这个变更流程没有PDD经理,那么', timestamp: 1500, startTimestampMs: 1500, endTimestampMs: 2400 }),
      segment({ text: '则由硬件SE做决策。', timestamp: 3200, startTimestampMs: 3200, endTimestampMs: 4100 }),
      segment({ text: '请问大家是不是需要PTT经理?', timestamp: 5100, startTimestampMs: 5100, endTimestampMs: 6100 }),
      segment({ text: '变更', timestamp: 7200, startTimestampMs: 7200, endTimestampMs: 7500 }),
      segment({ text: '通常包含产', timestamp: 9000, startTimestampMs: 9000, endTimestampMs: 9400 }),
      segment({ text: '产品的成本', timestamp: 10900, startTimestampMs: 10900, endTimestampMs: 11300 }),
      segment({ text: '是否有增加以及', timestamp: 12700, startTimestampMs: 12700, endTimestampMs: 13200 }),
      segment({ text: '变更中物料', timestamp: 14800, startTimestampMs: 14800, endTimestampMs: 15200 }),
      segment({ text: '库存的处理所带来的变更损失。', timestamp: 16800, startTimestampMs: 16800, endTimestampMs: 17600 }),
    ];

    const transcript = mergeAll(coalescer, parts);

    assert.deepEqual(transcript.map(entry => entry.text), [
      '如果这个变更流程没有PDD经理,那么则由硬件SE做决策。',
      '请问大家是不是需要PTT经理?',
      '变更通常包含产产品的成本是否有增加以及变更中物料库存的处理所带来的变更损失。',
    ]);
  });

  test('uses a wider gap only for incomplete Mandarin fragments', async () => {
    const { TranscriptSegmentCoalescer } = await loadCoalescer();
    const coalescer = new TranscriptSegmentCoalescer();

    const result = coalescer.tryMerge(
      segment({ text: '变更', timestamp: 0, startTimestampMs: 0, endTimestampMs: 300 }),
      segment({ text: '通常包含产', timestamp: 2900, startTimestampMs: 2900, endTimestampMs: 3300 }),
    );
    const tooLate = coalescer.tryMerge(
      segment({ text: '变更', timestamp: 0, startTimestampMs: 0, endTimestampMs: 300 }),
      segment({ text: '通常包含产', timestamp: 3400, startTimestampMs: 3400, endTimestampMs: 3800 }),
    );

    assert.equal(result.merged, true);
    assert.equal(result.reason, 'zh_incomplete_fragment_gap');
    assert.equal(result.segment.text, '变更通常包含产');
    assert.equal(tooLate.merged, false);
    assert.equal(tooLate.reason, 'gap_too_large');
  });

  test('keeps hard speaker identity boundaries while allowing soft metadata mismatches', async () => {
    const { TranscriptSegmentCoalescer } = await loadCoalescer();
    const coalescer = new TranscriptSegmentCoalescer();

    assert.equal(coalescer.tryMerge(segment(), segment({ speaker: 'customer' })).reason, 'speaker_changed');
    assert.equal(coalescer.tryMerge(segment({ speakerId: 'a' }), segment({ speakerId: 'b' })).reason, 'speaker_id_changed');
    assert.equal(
      coalescer.tryMerge(segment({ providerSpeakerId: 'spk_0' }), segment({ providerSpeakerId: 'spk_1' })).reason,
      'provider_speaker_changed',
    );
    assert.equal(
      coalescer.tryMerge(segment({ diarizationProvider: 'local' }), segment({ diarizationProvider: 'cloud' })).reason,
      'provider_changed',
    );

    const merged = coalescer.tryMerge(
      segment({
        text: '如果',
        timestamp: 0,
        startTimestampMs: 0,
        endTimestampMs: 300,
        speakerVerification: { profileId: 'a' },
        emotion: 'happy',
        emotionSource: 'sensevoice',
      }),
      segment({
        text: '这个流程需要审批',
        timestamp: 1500,
        startTimestampMs: 1500,
        endTimestampMs: 2100,
        speakerVerification: { profileId: 'b' },
        emotion: 'neutral',
        emotionSource: 'sensevoice',
      }),
    );

    assert.equal(merged.merged, true);
    assert.equal(merged.reason, 'metadata_soft_mismatch');
    assert.equal(merged.segment.text, '如果这个流程需要审批');
    assert.deepEqual(merged.segment.speakerVerification, { profileId: 'a' });
    assert.equal('emotion' in merged.segment, false);
    assert.equal('emotionSource' in merged.segment, false);
  });

  test('SessionTracker coalesces short QCLOUD provider utterances after diarized emission', async () => {
    const { SessionTracker } = await loadSessionTracker();
    const tracker = new SessionTracker();
    const now = Date.now();
    const qcloudBase = {
      speaker: 'interviewer',
      providerSpeakerId: '1',
      diarizationProvider: 'doubao-auc',
      final: true,
      confidence: 1,
    };

    tracker.handleTranscript({
      ...qcloudBase,
      text: '如果',
      timestamp: now,
      startTimestampMs: 0,
      endTimestampMs: 300,
    });
    tracker.handleTranscript({
      ...qcloudBase,
      text: '这个供应商',
      timestamp: now + 1400,
      startTimestampMs: 1700,
      endTimestampMs: 2300,
    });
    tracker.handleTranscript({
      ...qcloudBase,
      text: '评估不合格',
      timestamp: now + 2800,
      startTimestampMs: 3600,
      endTimestampMs: 4300,
    });
    tracker.handleTranscript({
      ...qcloudBase,
      text: '要控制ERP不能下单。',
      timestamp: now + 3900,
      startTimestampMs: 5200,
      endTimestampMs: 6200,
    });

    const transcript = tracker.getFullTranscript();

    assert.equal(transcript.length, 1);
    assert.equal(transcript[0].text, '如果这个供应商评估不合格要控制ERP不能下单。');
    assert.equal(transcript[0].coalescedProvider, 'post_stt');
    assert.equal(transcript[0].coalescedFromCount, 4);
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
