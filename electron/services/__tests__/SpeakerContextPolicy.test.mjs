import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { performance } from 'node:perf_hooks';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadSpeakerContextPolicy() {
  const policyPath = path.resolve(__dirname, '../../../dist-electron/electron/services/context/SpeakerContextPolicy.js');
  return import(pathToFileURL(policyPath).href);
}

async function loadTranscriptCleaner() {
  const cleanerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/transcriptCleaner.js');
  return import(pathToFileURL(cleanerPath).href);
}

const turn = (timestamp, role, text, extra = {}) => ({ role, text, timestamp, ...extra });

describe('SpeakerContextPolicy', () => {
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
});
