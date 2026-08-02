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
  verificationStats = [];
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
  recordVerificationStat(input) {
    this.verificationStats.push(input);
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
  assert.equal(store.profile.threshold, store.profile.quality.calibratedThreshold);
  assert.equal(Object.hasOwn(store.profile, 'samples'), false);
});

test('verification rejects confidence below the calibrated enrollment threshold', async () => {
  const { SpeakerEnrollmentService } = await import('../../../dist-electron/electron/services/speaker/SpeakerEnrollmentService.js');
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const store = new MemoryStore();
  await new SpeakerEnrollmentService({
    store,
    extractor: new FakeExtractor(),
    threshold: 0.9,
  }).enroll([
    { samples: loudSamples(3), sampleRate: 16000 },
    { samples: loudSamples(3), sampleRate: 16000 },
    { samples: loudSamples(3), sampleRate: 16000 },
  ]);

  const result = await new SpeakerVerificationService({
    store,
    extractor: new FakeExtractor([0.8, 0.6, 0, 0]),
  }).verify(loudSamples(2));

  assert.equal(store.profile.threshold, store.profile.quality.calibratedThreshold);
  assert.ok(result.speakerVerification.confidence < store.profile.quality.calibratedThreshold);
  assert.equal(result.speakerVerification.isMe, false);
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

test('audio quality uses distinct enrollment and verification duration thresholds', async () => {
  const { measureAudioQuality } = await import('../../../dist-electron/electron/services/speaker/speakerAudioUtils.js');
  const policy = {
    minDurationMs: 2500,
    minVerificationDurationMs: 1000,
    minRms: 0.005,
    minVoiceRatio: 0.12,
    voiceSampleThreshold: 0.01,
  };

  assert.equal(measureAudioQuality(loudSamples(2), policy, { durationKind: 'enrollment' }).reason, 'too_short');
  assert.equal(measureAudioQuality(loudSamples(2), policy, { durationKind: 'verification' }).ok, true);
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
  assert.equal(store.verificationStats.length, 1);
  assert.equal(store.verificationStats[0].outcome, 'positive');
  assert.ok(store.verificationStats[0].latencyMs >= 0);
});

test('verification records low confidence when a real verification is not ME', async () => {
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const store = new MemoryStore();
  store.profile = {
    id: 'me', label: 'ME', embedding: new Float32Array([1, 0, 0, 0]), embeddingDim: 4,
    extractorModel: 'fake', extractorVersion: 'v1', threshold: 0.72, enrolledAt: 1, updatedAt: 1, sampleCount: 3,
  };

  const result = await new SpeakerVerificationService({
    store,
    extractor: new FakeExtractor([0, 1, 0, 0]),
  }).verify(loudSamples(2));

  assert.equal(result.status, 'verified');
  assert.equal(result.speakerVerification.isMe, false);
  assert.deepEqual(store.verificationStats.map(({ outcome }) => outcome), ['low_confidence']);
});

test('verification records low-quality, extractor errors, and timeouts as reliability outcomes', async () => {
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const store = new MemoryStore();
  store.profile = {
    id: 'me', label: 'ME', embedding: new Float32Array([1, 0, 0, 0]), embeddingDim: 4,
    extractorModel: 'fake', extractorVersion: 'v1', threshold: 0.72, enrolledAt: 1, updatedAt: 1, sampleCount: 3,
  };
  const lowQuality = await new SpeakerVerificationService({ store, extractor: new FakeExtractor() }).verify(new Float32Array());
  const failedService = new SpeakerVerificationService({
    store,
    extractor: { dim: 4, modelId: 'fake', version: 'v1', extract: async () => { throw new Error('test failure'); } },
  });
  const failed = await failedService.verify(loudSamples(2));
  failedService.recordTimeout();

  assert.equal(lowQuality.status, 'low_quality');
  assert.equal(failed.status, 'error');
  assert.deepEqual(store.verificationStats.map(({ outcome }) => outcome), ['low_quality', 'error', 'timeout']);
  assert.ok(store.verificationStats.slice(0, 2).every(({ latencyMs }) => latencyMs >= 0));
  assert.equal(store.verificationStats[1].error, 'speaker_verification_failed');
});

test('annotator skips short verification segments and preserves qualified metadata', async () => {
  const { SpeakerVerificationAnnotator } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js');
  let verifyCalls = 0;
  let lowQualityCalls = 0;
  const service = { verify: async () => {
    verifyCalls += 1;
    return { status: 'verified', speakerVerification: { provider: 'local-speaker-verification', profileId: 'me', isMe: true, confidence: 1, threshold: 0.72 } };
  }, recordLowQuality: () => { lowQualityCalls += 1; } };

  const disabled = new SpeakerVerificationAnnotator({ getMode: () => 'off', service });
  assert.equal(await disabled.annotate(loudSamples(2)), undefined);
  assert.equal(verifyCalls, 0, 'mode off must not emit speakerVerification or invoke verification');

  const enabled = new SpeakerVerificationAnnotator({ getMode: () => 'local', service });
  assert.equal(await enabled.annotate(loudSamples(0.5)), undefined);
  assert.equal(verifyCalls, 0, 'short audio must not invoke verification');
  assert.equal(lowQualityCalls, 1, 'short audio must record one low-quality skip');

  const metadata = await enabled.annotate(loudSamples(2));
  assert.equal(verifyCalls, 1);
  assert.equal(metadata?.isMe, true);
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

test('annotator timeout prevents a late verification from recording another outcome', async () => {
  const { SpeakerVerificationAnnotator } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js');
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const store = new MemoryStore();
  store.profile = {
    id: 'me', label: 'ME', embedding: new Float32Array([1, 0, 0, 0]), embeddingDim: 4,
    extractorModel: 'fake', extractorVersion: 'v1', threshold: 0.72, enrolledAt: 1, updatedAt: 1, sampleCount: 3,
  };
  const service = new SpeakerVerificationService({
    store,
    extractor: {
      dim: 4,
      modelId: 'fake',
      version: 'v1',
      extract: async () => {
        await new Promise(resolve => setTimeout(resolve, 60));
        return new Float32Array([1, 0, 0, 0]);
      },
    },
  });
  const annotator = new SpeakerVerificationAnnotator({ getMode: () => 'local', service, timeoutMs: 20 });

  assert.equal(await annotator.annotate(loudSamples(2)), undefined);
  assert.deepEqual(store.verificationStats.map(({ outcome }) => outcome), ['timeout']);
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.deepEqual(store.verificationStats.map(({ outcome }) => outcome), ['timeout']);
});
