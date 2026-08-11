import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';

const modulePath = path.resolve(
  import.meta.dirname,
  '../../../dist-electron/shared/speakerConfirmation.js',
);

async function loadPolicy() {
  return import(modulePath);
}

function segment(overrides = {}) {
  return {
    speaker: 'interviewer',
    text: '这个价格超出我们的预算',
    timestamp: 1_000,
    speakerVerification: {
      provider: 'local-speaker-verification',
      profileId: 'me',
      isMe: false,
      confidence: 0.3,
      threshold: 0.72,
    },
    ...overrides,
  };
}

test('speaker confirmation requires a consequential action and verification evidence', async () => {
  const { buildDynamicActionSpeakerConfirmation } = await loadPolicy();

  assert.equal(buildDynamicActionSpeakerConfirmation({
    segment: segment(),
    hasConsequentialAction: false,
  }), undefined);
  assert.equal(buildDynamicActionSpeakerConfirmation({
    segment: segment({ speakerVerification: undefined }),
    hasConsequentialAction: true,
  }), undefined);
});

test('speaker confirmation ignores punctuation and one-character filler', async () => {
  const { buildDynamicActionSpeakerConfirmation } = await loadPolicy();

  for (const text of ['.', '。', '嗯', '  !  ']) {
    assert.equal(buildDynamicActionSpeakerConfirmation({
      segment: segment({ text }),
      hasConsequentialAction: true,
    }), undefined);
  }
});

test('speaker confirmation is required near the verification threshold', async () => {
  const { buildDynamicActionSpeakerConfirmation } = await loadPolicy();
  const input = segment({
    speakerVerification: {
      provider: 'local-speaker-verification',
      profileId: 'me',
      isMe: false,
      confidence: 0.7,
      threshold: 0.72,
    },
  });

  assert.deepEqual(buildDynamicActionSpeakerConfirmation({
    segment: input,
    hasConsequentialAction: true,
  }), {
    speaker: 'interviewer',
    timestamp: 1_000,
    text: '这个价格超出我们的预算',
  });
});

test('speaker confirmation is required when verification conflicts with capture channel', async () => {
  const { buildDynamicActionSpeakerConfirmation } = await loadPolicy();
  const input = segment({
    speaker: 'user',
    speakerVerification: {
      provider: 'local-speaker-verification',
      profileId: 'me',
      isMe: false,
      confidence: 0.3,
      threshold: 0.72,
    },
  });

  assert.equal(buildDynamicActionSpeakerConfirmation({
    segment: input,
    hasConsequentialAction: true,
  })?.speaker, 'user');
});

test('speaker confirmation is omitted when verification confidently agrees with capture channel', async () => {
  const { buildDynamicActionSpeakerConfirmation } = await loadPolicy();

  assert.equal(buildDynamicActionSpeakerConfirmation({
    segment: segment(),
    hasConsequentialAction: true,
  }), undefined);
  assert.equal(buildDynamicActionSpeakerConfirmation({
    segment: segment({
      speaker: 'user',
      speakerVerification: {
        provider: 'local-speaker-verification',
        profileId: 'me',
        isMe: true,
        confidence: 0.9,
        threshold: 0.72,
      },
    }),
    hasConsequentialAction: true,
  }), undefined);
});

test('speaker confirmation segment identity requires speaker, timestamp, and normalized full text', async () => {
  const { sameSpeakerConfirmationSegment } = await loadPolicy();
  const target = { speaker: 'interviewer', timestamp: 1_000, text: '价格  太高' };

  assert.equal(sameSpeakerConfirmationSegment(target, {
    speaker: 'interviewer', timestamp: 1_000, text: '价格 太高',
  }), true);
  assert.equal(sameSpeakerConfirmationSegment(target, {
    speaker: 'interviewer', timestamp: 1_001, text: '价格 太高',
  }), false);
  assert.equal(sameSpeakerConfirmationSegment(target, {
    speaker: 'user', timestamp: 1_000, text: '价格 太高',
  }), false);
  assert.equal(sameSpeakerConfirmationSegment(target, {
    speaker: 'interviewer', timestamp: 1_000, text: '太高',
  }), false);
});
