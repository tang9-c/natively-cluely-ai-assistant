import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadSpeakerContextPolicy() {
  const policyPath = path.resolve(__dirname, '../../../dist-electron/electron/services/context/SpeakerContextPolicy.js');
  return import(pathToFileURL(policyPath).href);
}

async function loadTranscriptCleaner() {
  const cleanerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/transcriptCleaner.js');
  return import(pathToFileURL(cleanerPath).href);
}

async function loadSessionTracker() {
  const trackerPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(trackerPath).href);
}

async function loadSpeakerEnrollmentService() {
  const servicePath = path.resolve(__dirname, '../../../dist-electron/electron/services/speaker/SpeakerEnrollmentService.js');
  return import(pathToFileURL(servicePath).href);
}

async function loadSpeakerVerificationService() {
  const servicePath = path.resolve(__dirname, '../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  return import(pathToFileURL(servicePath).href);
}

const turn = (timestamp, role, text, extra = {}) => ({ role, text, timestamp, ...extra });

function loudSamples(seconds = 2, sampleRate = 16000, frequency = 220) {
  const samples = new Float32Array(seconds * sampleRate);
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = Math.sin((i / sampleRate) * frequency * Math.PI * 2) * 0.2;
  }
  return samples;
}

class MemorySpeakerStore {
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

class FakeSpeakerExtractor {
  dim = 4;
  modelId = 'fake-speaker-model';
  version = 'fake-version';
  constructor(vector = [1, 0, 0, 0]) {
    this.vector = vector;
  }
  async extract() {
    return new Float32Array(this.vector);
  }
}

describe('SpeakerContextPolicy', () => {
  test('stable enrollment verifies ME and reaches transcript cleaner as [ME]', async () => {
    const { SpeakerEnrollmentService } = await loadSpeakerEnrollmentService();
    const { SpeakerVerificationService } = await loadSpeakerVerificationService();
    const { evaluateSpeakerContextForAnswer } = await loadSpeakerContextPolicy();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();
    const store = new MemorySpeakerStore();
    const extractor = new FakeSpeakerExtractor([1, 0, 0, 0]);

    await new SpeakerEnrollmentService({ store, extractor }).enroll([
      { samples: loudSamples(3), sampleRate: 16000 },
      { samples: loudSamples(3), sampleRate: 16000 },
      { samples: loudSamples(3), sampleRate: 16000 },
    ]);
    const verification = await new SpeakerVerificationService({ store, extractor }).verify(loudSamples(2));
    const result = evaluateSpeakerContextForAnswer([
      turn(1, 'interviewer', 'I will send the implementation plan.', {
        speakerVerification: verification.speakerVerification,
      }),
    ]);
    const prompt = prepareTranscriptForWhatToAnswer(result.turns, 12);

    assert.equal(verification.status, 'verified');
    assert.equal(verification.speakerVerification.isMe, true);
    assert.match(prompt, /\[ME\]: i will send the implementation plan\./);
    assert.deepEqual(store.verificationStats.map(({ outcome }) => outcome), ['positive']);
  });

  test('keeps high-confidence local verification as ME and records confidence trace', async () => {
    const { evaluateSpeakerContextForAnswer } = await loadSpeakerContextPolicy();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();

    const result = evaluateSpeakerContextForAnswer([
      turn(1, 'interviewer', 'I can take the legal follow up.', {
        speakerLabel: 'Candidate',
        speakerVerification: {
          provider: 'local-speaker-verification',
          profileId: 'me',
          isMe: true,
          confidence: 0.86,
          threshold: 0.72,
        },
      }),
    ]);

    const prompt = prepareTranscriptForWhatToAnswer(result.turns, 12);

    assert.match(prompt, /\[ME\]: i can take the legal follow up\./);
    assert.deepEqual(result.degradedReasons, []);
    assert.equal(result.trace.speakerMetadataUsed, true);
    assert.equal(result.trace.localVerificationUsed, true);
    assert.equal(result.trace.degraded, false);
    assert.equal(result.trace.confidenceSummary.verifiedMeCount, 1);
    assert.equal(result.trace.confidenceSummary.minConfidence, 0.86);
    assert.equal(result.trace.confidenceSummary.maxConfidence, 0.86);
  });

  test('removes low-confidence ME assertion and records explicit degradation', async () => {
    const { evaluateSpeakerContextForAnswer } = await loadSpeakerContextPolicy();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();

    const result = evaluateSpeakerContextForAnswer([
      turn(1, 'interviewer', 'I can own the security review.', {
        speakerLabel: 'Candidate',
        speakerVerification: {
          provider: 'local-speaker-verification',
          profileId: 'me',
          isMe: true,
          confidence: 0.61,
          threshold: 0.72,
        },
      }),
    ]);

    const prompt = prepareTranscriptForWhatToAnswer(result.turns, 12);

    assert.doesNotMatch(prompt, /\[ME\]/);
    assert.match(prompt, /\[INTERVIEWER: Candidate\]: i can own the security review\./);
    assert.ok(result.degradedReasons.includes('speaker_metadata_low_confidence'));
    assert.equal(result.trace.degraded, true);
    assert.equal(result.trace.confidenceSummary.lowConfidenceCount, 1);
  });

  test('keeps diarization-only labels as grouping, not identity', async () => {
    const { evaluateSpeakerContextForAnswer } = await loadSpeakerContextPolicy();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();

    const result = evaluateSpeakerContextForAnswer([
      turn(1, 'interviewer', 'Jordan asked for legal next steps.', {
        speakerId: 'speaker-1',
        speakerLabel: 'Jordan',
        providerSpeakerId: 'speaker-1',
        diarizationProvider: 'doubao-auc',
      }),
      turn(2, 'interviewer', 'Priya raised security review risk.', {
        speakerId: 'speaker-2',
        speakerLabel: 'Priya',
        providerSpeakerId: 'speaker-2',
        diarizationProvider: 'doubao-auc',
      }),
    ]);

    const prompt = prepareTranscriptForWhatToAnswer(result.turns, 12);

    assert.match(prompt, /\[INTERVIEWER: Jordan\]: jordan asked for legal next steps\./);
    assert.match(prompt, /\[INTERVIEWER: Priya\]: priya raised security review risk\./);
    assert.doesNotMatch(prompt, /\[ME\]/);
    assert.equal(result.trace.diarizationUsed, true);
    assert.deepEqual(result.trace.sources, ['doubao-auc']);
  });

  test('ignores malformed speaker verification without throwing', async () => {
    const { evaluateSpeakerContextForAnswer } = await loadSpeakerContextPolicy();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();

    const result = evaluateSpeakerContextForAnswer([
      turn(1, 'interviewer', 'The next step is legal review.', {
        speakerLabel: 'Candidate',
        speakerVerification: {
          provider: 'local-speaker-verification',
          profileId: 'me',
          isMe: true,
          confidence: 'very high',
          threshold: 0.72,
        },
      }),
    ]);

    const prompt = prepareTranscriptForWhatToAnswer(result.turns, 12);

    assert.doesNotMatch(prompt, /\[ME\]/);
    assert.ok(result.degradedReasons.includes('speaker_metadata_unavailable'));
    assert.equal(result.trace.degraded, true);
    assert.equal(result.trace.confidenceSummary.unknownCount, 1);
  });

  test('runs speaker policy under 10ms for 500 turns', async () => {
    const { evaluateSpeakerContextForAnswer } = await loadSpeakerContextPolicy();
    const turns = Array.from({ length: 500 }, (_, index) => turn(
      index + 1,
      'interviewer',
      `Speaker ${index % 5} discussed follow up item number ${index}.`,
      {
        speakerId: `speaker-${index % 5}`,
        speakerLabel: `Speaker ${index % 5}`,
        providerSpeakerId: `speaker-${index % 5}`,
        diarizationProvider: 'doubao-auc',
      },
    ));

    const startedAt = performance.now();
    const result = evaluateSpeakerContextForAnswer(turns);
    const elapsedMs = performance.now() - startedAt;

    assert.equal(result.turns.length, 500);
    assert.ok(elapsedMs < 10, `expected policy under 10ms, got ${elapsedMs}ms`);
  });

  test('session override can remove and force ME only for current session', async () => {
    const { SessionTracker } = await loadSessionTracker();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();
    const session = new SessionTracker();
    const verifiedSegment = {
      speaker: 'interviewer',
      text: 'I will send the pricing follow up.',
      timestamp: Date.now(),
      final: true,
      speakerLabel: 'Candidate',
      speakerVerification: {
        provider: 'local-speaker-verification',
        profileId: 'me',
        isMe: true,
        confidence: 0.92,
        threshold: 0.72,
      },
    };
    const unverifiedSegment = {
      speaker: 'interviewer',
      text: 'I own the legal review.',
      timestamp: verifiedSegment.timestamp + 1,
      final: true,
      speakerLabel: 'Candidate',
    };

    session.addTranscript(verifiedSegment);
    assert.equal(session.setSpeakerVerificationOverride({
      speaker: verifiedSegment.speaker,
      timestamp: verifiedSegment.timestamp,
      text: verifiedSegment.text,
      action: 'force_not_me',
    }), true);
    let prompt = prepareTranscriptForWhatToAnswer(session.getContext(180), 12);
    assert.doesNotMatch(prompt, /\[ME\]: i will send the pricing follow up\./);
    assert.equal(session.getFullTranscript()[0].speakerVerification.isMe, true);
    assert.equal(session.getEffectiveFullTranscript()[0].speakerVerification, undefined);

    session.addTranscript(unverifiedSegment);
    assert.equal(session.setSpeakerVerificationOverride({
      speaker: unverifiedSegment.speaker,
      timestamp: unverifiedSegment.timestamp,
      text: unverifiedSegment.text,
      action: 'force_me',
    }), true);
    prompt = prepareTranscriptForWhatToAnswer(session.getContext(180), 12);
    assert.match(prompt, /\[ME\]: i own the legal review\./);
    assert.match(session.getFullSessionContext(), /\[ME\]: I own the legal review\./);
    assert.notEqual(session.getLastInterviewerTurn(), unverifiedSegment.text);
    assert.equal(session.getFullTranscript()[1].speaker, 'interviewer');
    assert.equal(session.getEffectiveFullTranscript()[1].speaker, 'user');

    session.reset();
    assert.equal(session.getContext(180).length, 0);
    assert.equal(session.setSpeakerVerificationOverride({
      speaker: unverifiedSegment.speaker,
      timestamp: unverifiedSegment.timestamp,
      text: unverifiedSegment.text,
      action: 'force_me',
    }), false);
  });

  test('force_not_me removes ME label even when the original segment came from user mic', async () => {
    const { SessionTracker } = await loadSessionTracker();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();
    const session = new SessionTracker();
    const userSegment = {
      speaker: 'user',
      text: 'This phrase was captured on the wrong microphone.',
      timestamp: Date.now(),
      final: true,
    };

    session.addTranscript(userSegment);
    assert.equal(session.setSpeakerVerificationOverride({
      speaker: userSegment.speaker,
      timestamp: userSegment.timestamp,
      text: userSegment.text,
      action: 'force_not_me',
    }), true);

    const prompt = prepareTranscriptForWhatToAnswer(session.getContext(180), 12);
    assert.doesNotMatch(prompt, /\[ME\]/);
    assert.match(prompt, /\[INTERVIEWER\]: this phrase was captured on the wrong microphone\./);
    assert.doesNotMatch(session.getFullSessionContext(), /\[ME\]/);
    assert.match(session.getFullSessionContext(), /\[INTERVIEWER\]: This phrase was captured on the wrong microphone\./);
  });

  test('session override can target a transcript after it was merged with the previous final segment', async () => {
    const { SessionTracker } = await loadSessionTracker();
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();
    const session = new SessionTracker();
    const now = Date.now();
    const firstSegment = {
      speaker: 'interviewer',
      text: 'I will send',
      timestamp: now,
      endTimestampMs: now + 200,
      final: true,
      speakerVerification: {
        provider: 'local-speaker-verification',
        profileId: 'me',
        isMe: true,
        confidence: 0.94,
        threshold: 0.72,
      },
    };
    const secondSegment = {
      speaker: 'interviewer',
      text: 'the pricing follow up',
      timestamp: now + 500,
      endTimestampMs: now + 900,
      final: true,
      speakerVerification: firstSegment.speakerVerification,
    };

    session.addTranscript(firstSegment);
    session.addTranscript(secondSegment);
    assert.equal(session.getFullTranscript().length, 1);
    assert.equal(session.setSpeakerVerificationOverride({
      speaker: secondSegment.speaker,
      timestamp: secondSegment.timestamp,
      text: secondSegment.text,
      action: 'force_not_me',
    }), true);

    const prompt = prepareTranscriptForWhatToAnswer(session.getContext(180), 12);
    assert.doesNotMatch(prompt, /\[ME\]/);
    assert.match(prompt, /\[INTERVIEWER\]: i will send the pricing follow up/);
  });

  test('dynamic action path uses the session-overridden segment for speaker skip checks', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '../../../electron/IntelligenceEngine.ts'), 'utf8');
    assert.match(source, /const effectiveSegment = this\.session\.applySpeakerVerificationOverride\(segment\)/);
    assert.match(source, /detectConfirmAndEmitDynamicActions\(effectiveSegment, latencyContext\)/);
    assert.match(source, /observeDynamicActionContinuation\(effectiveSegment, providerDataScopes\)/);
    assert.match(source, /getEffectiveFullTranscript\(\)\.slice\(-12\)/);
    assert.match(source, /handleSpeakerVerificationSessionOverride/);
    assert.match(source, /detectConfirmAndEmitDynamicActions\(segment, latencyContext\)/);
    assert.match(source, /status: 'dismissed'/);
  });

  test('meeting persistence keeps raw transcript and stopMeeting clears overrides after save', () => {
    const trackerSource = fs.readFileSync(path.resolve(__dirname, '../../../electron/SessionTracker.ts'), 'utf8');
    const managerSource = fs.readFileSync(path.resolve(__dirname, '../../../electron/IntelligenceManager.ts'), 'utf8');
    const persistenceSource = fs.readFileSync(path.resolve(__dirname, '../../../electron/MeetingPersistence.ts'), 'utf8');

    assert.match(trackerSource, /getFullSessionContext\(\): string \{\s*const recentTranscript = this\.getEffectiveFullTranscript\(\)\.map/);
    assert.match(trackerSource, /getFullTranscript\(\): TranscriptSegment\[\] \{\s*return this\.fullTranscript;/);
    assert.match(trackerSource, /getEffectiveFullTranscript\(\): TranscriptSegment\[\]/);
    assert.match(persistenceSource, /transcript: \[\.\.\.this\.session\.getFullTranscript\(\)\]/);
    assert.match(managerSource, /finally \{\s*this\.session\.clearSpeakerVerificationOverrides\(\);/);
  });
});
