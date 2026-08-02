import assert from 'node:assert/strict';
import { test } from 'node:test';

function loudSamples(seconds = 2, sampleRate = 16000, frequency = 220) {
  const samples = new Float32Array(seconds * sampleRate);
  for (let i = 0; i < samples.length; i++) {
    samples[i] = Math.sin((i / sampleRate) * frequency * Math.PI * 2) * 0.2;
  }
  return samples;
}

class MemoryStore {
  profile = null;
  getMeProfile() {
    return this.profile;
  }
  saveMeProfile(input) {
    this.profile = {
      id: 'me',
      label: 'ME',
      embedding: input.embedding,
      embeddingDim: input.embeddingDim,
      extractorModel: input.extractorModel,
      extractorVersion: input.extractorVersion,
      threshold: input.threshold,
      enrolledAt: input.nowMs ?? 1,
      updatedAt: input.nowMs ?? 1,
      deviceFingerprint: input.deviceFingerprint,
      sampleCount: input.sampleCount,
      quality: input.quality,
    };
  }
  getStatus(mode = 'off') {
    return this.profile
      ? { enrolled: true, enrolledAt: this.profile.enrolledAt, model: this.profile.extractorModel, mode }
      : { enrolled: false, mode };
  }
}

class FakeExtractor {
  dim = 4;
  modelId = 'fake-speaker-model';
  version = 'fake-version';
  constructor(privateVector = [1, 0, 0, 0]) {
    this.privateVector = privateVector;
  }
  async extract(samples) {
    const energy = samples.reduce((sum, value) => sum + Math.abs(value), 0);
    return energy > 1
      ? new Float32Array(this.privateVector)
      : new Float32Array([0, 1, 0, 0]);
  }
}

class SplitEmbeddingExtractor extends FakeExtractor {
  calls = 0;
  async extract() {
    this.calls += 1;
    return new Float32Array(this.calls % 2 ? [1, 0, 0, 0] : [0, 1, 0, 0]);
  }
}

test('enrollment stores one normalized ME profile and discards raw audio', async () => {
  const { SpeakerEnrollmentService } = await import('../../../dist-electron/electron/services/speaker/SpeakerEnrollmentService.js');
  const store = new MemoryStore();
  const service = new SpeakerEnrollmentService({
    store,
    extractor: new FakeExtractor(),
    threshold: 0.72,
    now: () => 1700000000000,
  });

  const status = await service.enroll([
    { samples: loudSamples(3), sampleRate: 16000, deviceFingerprint: 'mic-a' },
    { samples: loudSamples(3), sampleRate: 16000, deviceFingerprint: 'mic-a' },
    { samples: loudSamples(3), sampleRate: 16000, deviceFingerprint: 'mic-a' },
  ]);

  assert.equal(status.enrolled, true);
  assert.equal(store.profile.id, 'me');
  assert.equal(store.profile.label, 'ME');
  assert.equal(store.profile.embeddingDim, 4);
  assert.equal(store.profile.sampleCount, 3);
  assert.equal(store.profile.deviceFingerprint, 'mic-a');
  assert.equal(store.profile.quality.qualityBand, 'stable');
  assert.ok(store.profile.threshold >= 0.72);
  assert.equal(Object.hasOwn(store.profile, 'samples'), false);
});

test('enrollment rejects split embeddings without writing an unstable profile', async () => {
  const { SpeakerEnrollmentService } = await import('../../../dist-electron/electron/services/speaker/SpeakerEnrollmentService.js');
  const store = new MemoryStore();
  const service = new SpeakerEnrollmentService({
    store,
    extractor: new SplitEmbeddingExtractor(),
  });

  await assert.rejects(
    service.enroll([
      { samples: loudSamples(3), sampleRate: 16000 },
      { samples: loudSamples(3), sampleRate: 16000 },
      { samples: loudSamples(3), sampleRate: 16000 },
    ]),
    /speaker_enrollment_unstable_profile/,
  );
  assert.equal(store.profile, null);
});

test('verification skips when no profile exists', async () => {
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const service = new SpeakerVerificationService({
    store: new MemoryStore(),
    extractor: new FakeExtractor(),
  });

  const result = await service.verify(loudSamples(2));
  assert.equal(result.status, 'not_enrolled');
  assert.equal(result.speakerVerification, undefined);
});

test('verification returns ME metadata when similarity meets threshold', async () => {
  const { SpeakerEnrollmentService } = await import('../../../dist-electron/electron/services/speaker/SpeakerEnrollmentService.js');
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const store = new MemoryStore();
  const extractor = new FakeExtractor([1, 0, 0, 0]);
  await new SpeakerEnrollmentService({ store, extractor, threshold: 0.72 }).enroll([
    { samples: loudSamples(3), sampleRate: 16000 },
    { samples: loudSamples(3), sampleRate: 16000 },
    { samples: loudSamples(3), sampleRate: 16000 },
  ]);

  const result = await new SpeakerVerificationService({ store, extractor }).verify(loudSamples(2));
  assert.equal(result.status, 'verified');
  assert.equal(result.speakerVerification.provider, 'local-speaker-verification');
  assert.equal(result.speakerVerification.profileId, 'me');
  assert.equal(result.speakerVerification.isMe, true);
  assert.ok(result.speakerVerification.confidence >= 0.99);
});

test('annotator skips when disabled or service reports low quality', async () => {
  const { SpeakerVerificationAnnotator } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js');
  let verifyCalls = 0;
  const service = { verify: async (samples) => {
    verifyCalls += 1;
    return samples.length < 1000
    ? { status: 'low_quality' }
    : { status: 'verified', speakerVerification: { provider: 'local-speaker-verification', profileId: 'me', isMe: true, confidence: 1, threshold: 0.72 } };
  } };

  const disabled = new SpeakerVerificationAnnotator({ getMode: () => 'off', service });
  assert.equal(await disabled.annotate(loudSamples(2)), undefined);
  assert.equal(verifyCalls, 0, 'mode off must not emit speakerVerification or invoke verification');

  const enabled = new SpeakerVerificationAnnotator({ getMode: () => 'local', service });
  assert.equal(await enabled.annotate(new Float32Array(100)), undefined);
  assert.equal(verifyCalls, 1);
});

test('annotator times out hanging verification without blocking metadata fallback', async () => {
  const { SpeakerVerificationAnnotator } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js');
  let timeoutCount = 0;
  let onTimeoutCount = 0;
  const annotator = new SpeakerVerificationAnnotator({
    getMode: () => 'local',
    timeoutMs: 200,
    onTimeout: () => { onTimeoutCount += 1; },
    service: {
      verify: () => new Promise(() => {}),
      recordTimeout: () => { timeoutCount += 1; },
    },
  });

  const startedAt = Date.now();
  const result = await Promise.race([
    annotator.annotate(loudSamples(2)),
    new Promise(resolve => setTimeout(() => resolve('test_timeout'), 500)),
  ]);

  assert.equal(result, undefined);
  assert.ok(Date.now() - startedAt >= 175);
  assert.equal(timeoutCount, 1);
  assert.equal(onTimeoutCount, 1);
});
