import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

const replayModuleUrl = pathToFileURL(
  path.join(repoRoot, 'dist-electron/electron/services/qa/DynamicActionReplayRunner.js'),
).href;
const semanticGateModuleUrl = pathToFileURL(
  path.join(repoRoot, 'dist-electron/electron/services/dynamic-actions/ModeEventClassifier.js'),
).href;

function createReplayFixture({ modeTemplateType = 'recruiting', transcript, expected }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-replay-'));
  const fixtureRoot = path.join(root, 'fixtures');
  const audioRoot = path.join(root, 'audio');
  fs.mkdirSync(fixtureRoot, { recursive: true });
  fs.mkdirSync(audioRoot, { recursive: true });
  fs.writeFileSync(path.join(audioRoot, 'meeting.wav'), 'test audio', 'utf8');
  fs.writeFileSync(path.join(fixtureRoot, `${modeTemplateType}.json`), JSON.stringify([{
    id: 'fixture-1',
    modeTemplateType,
    language: 'en',
    transcriptTurns: [{ speaker: modeTemplateType === 'fde' ? 'customer' : 'candidate', text: transcript, final: true }],
    expected,
    tags: ['test'],
  }]), 'utf8');
  const manifestPath = path.join(root, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify([{
    id: 'meeting-1',
    modeTemplateType,
    sourceFixture: `${modeTemplateType}.json#fixture-1`,
    audioPath: 'meeting.wav',
    expectedMissingAudio: false,
    language: 'en',
    speakerCount: 1,
    syntheticAudio: true,
  }]), 'utf8');
  return { root, fixtureRoot, audioRoot, manifestPath };
}

function signReleaseAttestation(payload) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    document: {
      payload,
      signature: sign(null, Buffer.from(JSON.stringify(payload)), privateKey).toString('base64'),
    },
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey,
  };
}

test('Recruiting real STT replay is part of the default full test list and validates only recruiting audio fixtures', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/run-recruiting-real-stt-replay.mjs');
  const helper = read('scripts/dynamic-action-real-stt-replay-lib.mjs');
  const allRunner = read('scripts/run-test-all.mjs');

  assert.equal(
    pkg.scripts['test:dynamic-actions:recruiting-replay:real-stt'],
    'npm run build:electron && node scripts/run-recruiting-real-stt-replay.mjs',
  );
  assert.match(script, /modeTemplateType:\s*'recruiting'/);
  assert.match(script, /dynamic-action-real-stt-replay-lib\.mjs/);
  assert.match(helper, /QCLOUD_LIVE_API_KEY|NATIVELY_API_KEY/);
  assert.match(script, /DO NOT print API keys/i);
  assert.doesNotMatch(helper, /loadFixtureBackedSttTranscripts/);
  assert.match(helper, /blocked_missing_credentials/);
  assert.match(helper, /process\.exit\(0\)/);
  assert.doesNotMatch(helper, /throw new Error\('Missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY/);

  assert.match(allRunner, /name: 'recruiting-real-stt-replay'/);
  const stageStart = allRunner.indexOf("name: 'recruiting-real-stt-replay'");
  const stageEnd = allRunner.indexOf("name: 'e2e'", stageStart);
  assert.ok(stageStart >= 0 && stageEnd > stageStart, 'recruiting-real-stt-replay stage should appear before e2e');
  const stageBlock = allRunner.slice(stageStart, stageEnd);
  assert.match(stageBlock, /blockedOnMissingEnv/);
});

test('real replay rejects a missing cloud classifier before provider-backed evaluation', async () => {
  const { runDynamicActionReplay } = await import(replayModuleUrl);
  const fixture = createReplayFixture({
    transcript: 'Can you confirm visa support and the start date?',
    expected: { shouldEmit: true, actionType: 'candidate_concern', outputType: 'spoken_response' },
  });

  await assert.rejects(
    runDynamicActionReplay({
      manifestPath: fixture.manifestPath,
      fixtureRoot: fixture.fixtureRoot,
      audioRoot: fixture.audioRoot,
      outputDir: path.join(fixture.root, 'out'),
      modeTemplateTypes: ['recruiting'],
      semanticGateMode: 'real',
      transcribeAudio: async () => 'Can you confirm visa support and the start date?',
    }),
    /semanticGateMode "real" requires cloudClassifier/,
  );
});

test('real replay passes candidates to the injected classifier and obeys its decisions', async () => {
  const { runDynamicActionReplay } = await import(replayModuleUrl);
  const fixture = createReplayFixture({
    transcript: 'Can you confirm visa support and the start date?',
    expected: { shouldEmit: true, actionType: 'candidate_concern', outputType: 'spoken_response' },
  });
  const classifierInputs = [];
  const passReport = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'pass'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    cloudClassifier: async input => {
      classifierInputs.push(input);
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: candidate.actionType === 'candidate_concern' ? 'pass' : 'reject',
        confidence: 0.95,
      }));
    },
    transcribeAudio: async () => 'Can you confirm visa support and the start date?',
  });
  assert.ok(classifierInputs.some(input => input.candidates.some(candidate => candidate.actionType === 'candidate_concern')));
  assert.equal(passReport.entries[0].emitted, true);
  assert.equal(passReport.entries[0].actionType, 'candidate_concern');

  const rejectReport = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'reject'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    cloudClassifier: async input => input.candidates.map(candidate => ({
      actionType: candidate.actionType,
      decision: 'reject',
      confidence: 0.95,
    })),
    transcribeAudio: async () => 'Can you confirm visa support and the start date?',
  });
  assert.equal(rejectReport.entries[0].emitted, false);
});

test('QA QCloud classifier uses the production prompt/parser without fixture expected data', async () => {
  const { createQCloudReplaySemanticClassifier } = await import('../dynamic-action-real-stt-replay-lib.mjs');
  const { buildCloudSemanticGatePrompt } = await import(semanticGateModuleUrl);
  const requests = [];
  const input = {
    transcript: 'PRIVATE_TRANSCRIPT_SENTINEL',
    recentContextTurns: [],
    modeTemplateType: 'recruiting',
    speaker: 'candidate',
    candidates: [{
      actionType: 'candidate_concern',
      label: 'Candidate concern',
      match: 'visa support',
      confidence: 0.9,
      highRisk: true,
      fastPathEligible: false,
    }],
    fixture: { expected: { actionType: 'FIXTURE_EXPECTED_SENTINEL' } },
  };
  const classifier = createQCloudReplaySemanticClassifier({
    apiKey: 'test-key',
    endpoint: 'https://example.invalid/v1/chat/completions',
    model: 'test-model',
    post: async (url, body, options) => {
      requests.push({ url, body, options });
      return {
        data: {
          choices: [{ message: { content: '{"actions":[{"actionType":"candidate_concern","decision":"pass","confidence":0.94}]}' } }],
        },
      };
    },
  });

  const result = await classifier(input);
  assert.deepEqual(result, [{
    actionType: 'candidate_concern',
    decision: 'pass',
    confidence: 0.94,
    semanticIntent: undefined,
    reasons: undefined,
    rejectedCandidates: undefined,
  }]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://example.invalid/v1/chat/completions');
  assert.equal(requests[0].body.messages[0].content, buildCloudSemanticGatePrompt(input));
  assert.doesNotMatch(JSON.stringify(requests[0].body), /FIXTURE_EXPECTED_SENTINEL/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer test-key');
});

test('QA QCloud classifier redacts provider failures', async () => {
  const { createQCloudReplaySemanticClassifier } = await import('../dynamic-action-real-stt-replay-lib.mjs');
  const classifier = createQCloudReplaySemanticClassifier({
    apiKey: 'test-key',
    endpoint: 'https://example.invalid/v1/chat/completions',
    model: 'test-model',
    post: async () => {
      throw new Error('RAW_PROVIDER_ERROR_SENTINEL');
    },
  });

  await assert.rejects(
    classifier({
      transcript: 'PRIVATE_TRANSCRIPT_SENTINEL',
      recentContextTurns: [],
      modeTemplateType: 'recruiting',
      speaker: 'candidate',
      candidates: [],
    }),
    error => {
      assert.equal(error.message, 'cloud_provider_unavailable');
      assert.doesNotMatch(error.message, /RAW_PROVIDER_ERROR_SENTINEL|PRIVATE_TRANSCRIPT_SENTINEL/);
      return true;
    },
  );
});

test('real recruiting asset gate requires hashed real recordings and unique complete final-turn labels', async () => {
  const {
    buildRecruitingReplayDigest,
    evaluateRecruitingRealAssetGate,
  } = await import('../dynamic-action-real-stt-replay-lib.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-recruiting-assets-'));
  const realEntries = Array.from({ length: 5 }, (_, index) => {
    const audioPath = `meeting-${index}.wav`;
    const audio = `real meeting audio ${index}`;
    fs.writeFileSync(path.join(root, audioPath), audio, 'utf8');
    return {
      id: `meeting-${index}`,
      modeTemplateType: 'recruiting',
      audioPath,
      syntheticAudio: false,
      realAsset: {
        sourceKind: 'real_recording',
        meetingId: `private-meeting-${index}`,
        audioSha256: createHash('sha256').update(audio).digest('hex'),
      },
      labeledFinalTurns: Array.from({ length: 16 }, (_, turnIndex) => {
        const transcript = `candidate final turn ${index}-${turnIndex}`;
        return {
          turnId: `turn-${index}-${turnIndex}`,
          transcriptSha256: createHash('sha256').update(transcript).digest('hex'),
          expectedActionType: null,
          policyGroundingRequired: false,
          continuationChildExpected: false,
        };
      }),
    };
  });
  const syntheticEntry = {
    ...realEntries[0],
    id: 'synthetic-meeting',
    syntheticAudio: true,
    realAsset: undefined,
  };
  const attestationPayload = {
    runId: 'production-run-1',
    source: 'production_replay',
    assets: realEntries.map(entry => ({
      meetingId: entry.realAsset.meetingId,
      audioSha256: entry.realAsset.audioSha256,
      captureId: `capture-${entry.realAsset.meetingId}`,
    })),
    observations: realEntries.flatMap(entry => entry.labeledFinalTurns.map((label, index) => ({
      meetingId: entry.realAsset.meetingId,
      turnId: label.turnId,
      transcriptSha256: label.transcriptSha256,
      providerSpeakerId: `speaker-${entry.realAsset.meetingId}`,
      speakerRole: 'candidate',
      classifierTraceId: `trace-${entry.realAsset.meetingId}-${index}`,
      observedActionTypes: [],
      parentActionId: null,
      childActionIds: [],
      finalTurnAtMs: index * 1000,
      completedAtMs: index * 1000 + 100,
      childEmittedAtMs: null,
      policyGroundingUsed: false,
      positivePolicyCommitment: false,
      candidateFacingEvidenceLeak: false,
      unsafeVisibleAnswer: false,
    }))),
  };
  attestationPayload.replayDigest = buildRecruitingReplayDigest(attestationPayload);
  const signedAttestation = signReleaseAttestation(attestationPayload);
  const attestationDocument = signedAttestation.document;

  assert.deepEqual(evaluateRecruitingRealAssetGate({
    entries: [...realEntries, syntheticEntry],
    audioRoot: root,
    attestationDocument,
    attestationPublicKey: signedAttestation.publicKey,
  }), {
    status: 'ready',
    requiredRealMeetings: 5,
    availableRealMeetings: 5,
    requiredLabeledFinalTurns: 80,
    availableLabeledFinalTurns: 80,
    invalidReasons: [],
  });

  const duplicateGate = evaluateRecruitingRealAssetGate({
    entries: [
      ...realEntries.slice(0, 4),
      { ...realEntries[0], id: 'duplicate-manifest-row' },
      syntheticEntry,
    ],
    audioRoot: root,
    attestationDocument,
    attestationPublicKey: signedAttestation.publicKey,
  });
  assert.equal(duplicateGate.status, 'BLOCKED_REAL_RECRUITING_ASSETS');
  assert.ok(duplicateGate.invalidReasons.includes('duplicate_audio_sha256'));
  assert.ok(duplicateGate.invalidReasons.includes('duplicate_transcript_sha256'));

  realEntries[4].labeledFinalTurns.pop();
  assert.deepEqual(evaluateRecruitingRealAssetGate({
    entries: [...realEntries, syntheticEntry],
    audioRoot: root,
    attestationDocument,
    attestationPublicKey: signedAttestation.publicKey,
  }), {
    status: 'BLOCKED_REAL_RECRUITING_ASSETS',
    requiredRealMeetings: 5,
    availableRealMeetings: 5,
    requiredLabeledFinalTurns: 80,
    availableLabeledFinalTurns: 79,
    invalidReasons: [],
  });

  const tampered = structuredClone(realEntries);
  tampered[0].realAsset.audioSha256 = '0'.repeat(64);
  tampered[1].labeledFinalTurns[0].turnId = tampered[0].labeledFinalTurns[0].turnId;
  tampered[2].labeledFinalTurns[0].transcriptSha256 = 'not-a-hash';
  const tamperedGate = evaluateRecruitingRealAssetGate({
    entries: tampered,
    audioRoot: root,
    attestationDocument,
    attestationPublicKey: signedAttestation.publicKey,
  });
  assert.equal(tamperedGate.status, 'BLOCKED_REAL_RECRUITING_ASSETS');
  assert.ok(tamperedGate.invalidReasons.includes('audio_sha256_mismatch'));
  assert.ok(tamperedGate.invalidReasons.includes('duplicate_turn_id'));
  assert.ok(tamperedGate.invalidReasons.includes('invalid_final_turn_label'));

  assert.equal(evaluateRecruitingRealAssetGate({
    entries: realEntries,
    audioRoot: root,
    attestationDocument: { ...attestationDocument, signature: Buffer.alloc(64).toString('base64') },
    attestationPublicKey: signedAttestation.publicKey,
  }).status, 'BLOCKED_REAL_RECRUITING_ASSETS');
});

test('real recruiting replay evaluates each labeled final turn and reports prediction-derived release metrics', async () => {
  const {
    buildRecruitingClassifierTraceId,
    buildRecruitingReplayDigest,
    runDynamicActionReplay,
  } = await import(replayModuleUrl);
  const fixture = createReplayFixture({
    transcript: 'Can you confirm visa support?',
    expected: { shouldEmit: true, actionType: 'candidate_concern', outputType: 'spoken_response' },
  });
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  const audioPath = path.join(fixture.audioRoot, 'meeting.wav');
  const concernTranscript = 'Can you confirm visa support for this role?';
  const neutralTranscript = 'Thank you for the clarification.';
  manifest[0].syntheticAudio = false;
  manifest[0].realAsset = {
    sourceKind: 'real_recording',
    meetingId: 'private-meeting-1',
    audioSha256: createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex'),
  };
  manifest[0].labeledFinalTurns = [
    {
      turnId: 'turn-concern',
      transcriptSha256: createHash('sha256').update(concernTranscript).digest('hex'),
      expectedActionType: 'candidate_concern',
      policyGroundingRequired: true,
      continuationChildExpected: false,
    },
    {
      turnId: 'turn-neutral',
      transcriptSha256: createHash('sha256').update(neutralTranscript).digest('hex'),
      expectedActionType: null,
      policyGroundingRequired: false,
      continuationChildExpected: false,
    },
  ];
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest), 'utf8');

  const recruitingReleaseAttestationPayload = {
    runId: 'production-run-1',
    source: 'production_replay',
    assets: [{
      meetingId: 'private-meeting-1',
      audioSha256: manifest[0].realAsset.audioSha256,
      captureId: 'capture-private-meeting-1',
    }],
    observations: [
      {
        meetingId: 'private-meeting-1',
        turnId: 'turn-concern',
        transcriptSha256: manifest[0].labeledFinalTurns[0].transcriptSha256,
        providerSpeakerId: 'speaker-candidate',
        speakerRole: 'candidate',
        classifierTraceId: buildRecruitingClassifierTraceId({
          meetingId: 'private-meeting-1',
          turnId: 'turn-concern',
          transcriptSha256: manifest[0].labeledFinalTurns[0].transcriptSha256,
          providerSpeakerId: 'speaker-candidate',
          speakerRole: 'candidate',
          actionTypes: ['candidate_concern'],
          classifierInvoked: true,
        }),
        observedActionTypes: ['candidate_concern'],
        parentActionId: 'parent-concern',
        childActionIds: [],
        finalTurnAtMs: 1000,
        completedAtMs: 1100,
        childEmittedAtMs: null,
        policyGroundingUsed: true,
        positivePolicyCommitment: false,
        candidateFacingEvidenceLeak: false,
        unsafeVisibleAnswer: false,
      },
      {
        meetingId: 'private-meeting-1',
        turnId: 'turn-neutral',
        transcriptSha256: manifest[0].labeledFinalTurns[1].transcriptSha256,
        providerSpeakerId: 'speaker-candidate',
        speakerRole: 'candidate',
        classifierTraceId: buildRecruitingClassifierTraceId({
          meetingId: 'private-meeting-1',
          turnId: 'turn-neutral',
          transcriptSha256: manifest[0].labeledFinalTurns[1].transcriptSha256,
          providerSpeakerId: 'speaker-candidate',
          speakerRole: 'candidate',
          actionTypes: [],
          classifierInvoked: false,
        }),
        observedActionTypes: [],
        parentActionId: null,
        childActionIds: [],
        finalTurnAtMs: 2000,
        completedAtMs: 2100,
        childEmittedAtMs: null,
        policyGroundingUsed: false,
        positivePolicyCommitment: false,
        candidateFacingEvidenceLeak: false,
        unsafeVisibleAnswer: false,
      },
    ],
  };
  recruitingReleaseAttestationPayload.replayDigest = buildRecruitingReplayDigest(recruitingReleaseAttestationPayload);
  const signedAttestation = signReleaseAttestation(recruitingReleaseAttestationPayload);
  const recruitingReleaseAttestationDocument = signedAttestation.document;

  const classifiedTranscripts = [];
  const report = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'release'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    recruitingReleaseAttestationDocument,
    recruitingReleaseAttestationPublicKey: signedAttestation.publicKey,
    cloudClassifier: async input => {
      classifiedTranscripts.push(input.transcript);
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: input.transcript === concernTranscript && candidate.actionType === 'candidate_concern'
          ? 'pass'
          : 'reject',
        confidence: 0.95,
      }));
    },
    transcribeAudio: async () => ({
      text: `${concernTranscript} ${neutralTranscript}`,
      finalTurns: [
        { turnId: 'turn-concern', transcript: concernTranscript, providerSpeakerId: 'speaker-candidate' },
        { turnId: 'turn-neutral', transcript: neutralTranscript, providerSpeakerId: 'speaker-candidate' },
      ],
    }),
  });

  assert.ok(classifiedTranscripts.includes(concernTranscript));
  assert.equal(report.recruitingRelease?.metrics.realMeetingCount, 1);
  assert.equal(report.recruitingRelease?.metrics.labeledFinalTurnCount, 2);
  assert.equal(report.recruitingRelease?.metrics.precision, 1);
  assert.equal(report.recruitingRelease?.metrics.recall, 1);
  assert.equal(report.recruitingRelease?.metrics.overallFalsePositiveRate, 0);
  assert.deepEqual(report.recruitingRelease?.turns.map(turn => turn.turnId), ['turn-concern', 'turn-neutral']);
  assert.equal(report.recruitingRelease?.turns[0].classifierInvoked, true);
  assert.equal(report.recruitingRelease?.turns[0].classifierTraceId, recruitingReleaseAttestationPayload.observations[0].classifierTraceId);
  assert.ok(report.recruitingRelease?.gateFailures.includes('real_recruiting_meetings'));
  assert.ok(report.recruitingRelease?.gateFailures.includes('labeled_recruiting_final_turns'));
  assert.doesNotMatch(JSON.stringify(report), /Can you confirm visa support for this role|Thank you for the clarification/);

  const mismatchedPayload = structuredClone(recruitingReleaseAttestationPayload);
  mismatchedPayload.observations[0].observedActionTypes = [];
  mismatchedPayload.replayDigest = buildRecruitingReplayDigest(mismatchedPayload);
  const mismatchedAttestationDocument = {
    payload: mismatchedPayload,
    signature: sign(null, Buffer.from(JSON.stringify(mismatchedPayload)), signedAttestation.privateKey).toString('base64'),
  };
  const mismatchReport = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'release-mismatch'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    recruitingReleaseAttestationDocument: mismatchedAttestationDocument,
    recruitingReleaseAttestationPublicKey: signedAttestation.publicKey,
    cloudClassifier: async input => input.candidates.map(candidate => ({
      actionType: candidate.actionType,
      decision: input.transcript === concernTranscript && candidate.actionType === 'candidate_concern'
        ? 'pass'
        : 'reject',
      confidence: 0.95,
    })),
    transcribeAudio: async () => ({
      text: `${concernTranscript} ${neutralTranscript}`,
      finalTurns: [
        { turnId: 'turn-concern', transcript: concernTranscript, providerSpeakerId: 'speaker-candidate' },
        { turnId: 'turn-neutral', transcript: neutralTranscript, providerSpeakerId: 'speaker-candidate' },
      ],
    }),
  });
  assert.ok(mismatchReport.recruitingRelease?.gateFailures.includes('runtime_observation_action_mismatch'));

  const unverifiedReport = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'release-unverified'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    recruitingReleaseAttestationDocument: {
      ...recruitingReleaseAttestationDocument,
      signature: Buffer.alloc(64).toString('base64'),
    },
    recruitingReleaseAttestationPublicKey: signedAttestation.publicKey,
    cloudClassifier: async input => input.candidates.map(candidate => ({
      actionType: candidate.actionType,
      decision: 'reject',
      confidence: 0.95,
    })),
    transcribeAudio: async () => ({
      text: `${concernTranscript} ${neutralTranscript}`,
      finalTurns: [
        { turnId: 'turn-concern', transcript: concernTranscript, providerSpeakerId: 'speaker-candidate' },
        { turnId: 'turn-neutral', transcript: neutralTranscript, providerSpeakerId: 'speaker-candidate' },
      ],
    }),
  });
  assert.ok(unverifiedReport.recruitingRelease?.gateFailures.includes('trusted_runtime_attestation_missing'));
  assert.equal(unverifiedReport.recruitingRelease?.provenance.attestationRunId, 'missing');
});

test('real recruiting release classifies only STT final turns and rejects label transcript substitution', async () => {
  const { runDynamicActionReplay } = await import(replayModuleUrl);
  const fixture = createReplayFixture({
    transcript: 'Fixture-level text.',
    expected: { shouldEmit: false, actionType: null, outputType: 'checklist' },
  });
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  const audioPath = path.join(fixture.audioRoot, 'meeting.wav');
  const actualTranscript = 'Is this role fully remote?';
  const substitutedLabelTranscript = 'Can you confirm visa support?';
  manifest[0].syntheticAudio = false;
  manifest[0].realAsset = {
    sourceKind: 'real_recording',
    meetingId: 'private-meeting-stt-binding',
    audioSha256: createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex'),
  };
  manifest[0].labeledFinalTurns = [{
    turnId: 'turn-1',
    transcript: substitutedLabelTranscript,
    transcriptSha256: createHash('sha256').update(substitutedLabelTranscript).digest('hex'),
    expectedActionType: 'candidate_concern',
    policyGroundingRequired: true,
    continuationChildExpected: false,
  }];
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest), 'utf8');

  const classifiedTranscripts = [];
  const report = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'stt-binding'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    cloudClassifier: async input => {
      classifiedTranscripts.push(input.transcript);
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: 'reject',
        confidence: 0.95,
      }));
    },
    transcribeAudio: async () => ({
      text: actualTranscript,
      finalTurns: [{ turnId: 'turn-1', transcript: actualTranscript, providerSpeakerId: 'speaker-candidate' }],
    }),
  });

  assert.ok(classifiedTranscripts.includes(actualTranscript));
  assert.ok(!classifiedTranscripts.includes(substitutedLabelTranscript));
  assert.ok(report.recruitingRelease?.gateFailures.includes('stt_final_turn_transcript_mismatch'));
});

test('real recruiting release requires an external Ed25519 signature bound to the actual replay digest', async () => {
  const {
    buildRecruitingClassifierTraceId,
    buildRecruitingReplayDigest,
    runDynamicActionReplay,
  } = await import(replayModuleUrl);
  const fixture = createReplayFixture({
    transcript: 'Thank you for the clarification.',
    expected: { shouldEmit: false, actionType: null, outputType: 'checklist' },
  });
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  const audioPath = path.join(fixture.audioRoot, 'meeting.wav');
  const transcript = 'Thank you for the clarification.';
  const transcriptSha256 = createHash('sha256').update(transcript).digest('hex');
  const audioSha256 = createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex');
  const meetingId = 'private-meeting-signed';
  const turnId = 'turn-neutral';
  const providerSpeakerId = 'speaker-candidate';
  const speakerRole = 'candidate';
  const classifierTraceId = buildRecruitingClassifierTraceId({
    meetingId,
    turnId,
    transcriptSha256,
    providerSpeakerId,
    speakerRole,
    actionTypes: [],
    classifierInvoked: false,
  });
  const assets = [{ meetingId, audioSha256, captureId: 'capture-private-meeting-signed' }];
  const observations = [{
    meetingId,
    turnId,
    transcriptSha256,
    providerSpeakerId,
    speakerRole,
    classifierTraceId,
    observedActionTypes: [],
    parentActionId: null,
    childActionIds: [],
    finalTurnAtMs: 1000,
    completedAtMs: 1100,
    childEmittedAtMs: null,
    policyGroundingUsed: false,
    positivePolicyCommitment: false,
    candidateFacingEvidenceLeak: false,
    unsafeVisibleAnswer: false,
  }];
  const payload = {
    runId: 'production-run-signed',
    source: 'production_replay',
    replayDigest: buildRecruitingReplayDigest({ assets, observations }),
    assets,
    observations,
  };
  const signed = signReleaseAttestation(payload);
  manifest[0].syntheticAudio = false;
  manifest[0].realAsset = { sourceKind: 'real_recording', meetingId, audioSha256 };
  manifest[0].labeledFinalTurns = [{
    turnId,
    transcriptSha256,
    expectedActionType: null,
    policyGroundingRequired: false,
    continuationChildExpected: false,
  }];
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest), 'utf8');

  const report = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'signed-replay'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    recruitingReleaseAttestationDocument: signed.document,
    recruitingReleaseAttestationPublicKey: signed.publicKey,
    cloudClassifier: async input => input.candidates.map(candidate => ({
      actionType: candidate.actionType,
      decision: 'reject',
      confidence: 0.95,
    })),
    transcribeAudio: async () => ({
      text: transcript,
      finalTurns: [{ turnId, transcript, providerSpeakerId }],
    }),
  });
  assert.ok(!report.recruitingRelease?.gateFailures.includes('trusted_runtime_attestation_missing'));
  assert.ok(!report.recruitingRelease?.gateFailures.includes('actual_replay_digest_mismatch'));

  const tampered = structuredClone(signed.document);
  tampered.payload.replayDigest = '0'.repeat(64);
  const tamperedReport = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'tampered-replay'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    recruitingReleaseAttestationDocument: tampered,
    recruitingReleaseAttestationPublicKey: signed.publicKey,
    cloudClassifier: async () => [],
    transcribeAudio: async () => ({ text: transcript, finalTurns: [{ turnId, transcript, providerSpeakerId }] }),
  });
  assert.ok(tamperedReport.recruitingRelease?.gateFailures.includes('trusted_runtime_attestation_missing'));
});

test('real recruiting release speaker input comes from attested STT speaker identity, not the label', async () => {
  const {
    buildRecruitingClassifierTraceId,
    buildRecruitingReplayDigest,
    runDynamicActionReplay,
  } = await import(replayModuleUrl);
  const transcript = 'Is this role fully remote?';
  const transcriptSha256 = createHash('sha256').update(transcript).digest('hex');
  const fixture = createReplayFixture({
    transcript,
    expected: { shouldEmit: true, actionType: 'candidate_concern', outputType: 'spoken_response' },
  });
  const manifest = JSON.parse(fs.readFileSync(fixture.manifestPath, 'utf8'));
  const audioPath = path.join(fixture.audioRoot, 'meeting.wav');
  const audioSha256 = createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex');
  const meetingId = 'private-meeting-speaker';
  const turnId = 'turn-speaker';
  const providerSpeakerId = 'speaker-2';
  const speakerRole = 'candidate';
  const assets = [{ meetingId, audioSha256, captureId: 'capture-private-meeting-speaker' }];
  const observations = [{
    meetingId,
    turnId,
    transcriptSha256,
    providerSpeakerId,
    speakerRole,
    classifierTraceId: buildRecruitingClassifierTraceId({
      meetingId,
      turnId,
      transcriptSha256,
      providerSpeakerId,
      speakerRole,
      actionTypes: ['candidate_concern'],
      classifierInvoked: true,
    }),
    observedActionTypes: ['candidate_concern'],
    parentActionId: 'parent-speaker',
    childActionIds: [],
    finalTurnAtMs: 1000,
    completedAtMs: 1100,
    childEmittedAtMs: null,
    policyGroundingUsed: true,
    positivePolicyCommitment: false,
    candidateFacingEvidenceLeak: false,
    unsafeVisibleAnswer: false,
  }];
  const payload = {
    runId: 'production-run-speaker',
    source: 'production_replay',
    replayDigest: buildRecruitingReplayDigest({ assets, observations }),
    assets,
    observations,
  };
  const signed = signReleaseAttestation(payload);
  manifest[0].syntheticAudio = false;
  manifest[0].realAsset = { sourceKind: 'real_recording', meetingId, audioSha256 };
  manifest[0].labeledFinalTurns = [{
    turnId,
    transcriptSha256,
    expectedActionType: 'candidate_concern',
    speakerRole: 'recruiter',
    policyGroundingRequired: true,
    continuationChildExpected: false,
  }];
  fs.writeFileSync(fixture.manifestPath, JSON.stringify(manifest), 'utf8');

  const classifierSpeakers = [];
  const report = await runDynamicActionReplay({
    manifestPath: fixture.manifestPath,
    fixtureRoot: fixture.fixtureRoot,
    audioRoot: fixture.audioRoot,
    outputDir: path.join(fixture.root, 'speaker-binding'),
    modeTemplateTypes: ['recruiting'],
    semanticGateMode: 'real',
    recruitingReleaseAttestationDocument: signed.document,
    recruitingReleaseAttestationPublicKey: signed.publicKey,
    cloudClassifier: async input => {
      classifierSpeakers.push(input.speaker);
      return input.candidates.map(candidate => ({
        actionType: candidate.actionType,
        decision: candidate.actionType === 'candidate_concern' ? 'pass' : 'reject',
        confidence: 0.95,
      }));
    },
    transcribeAudio: async () => ({
      text: transcript,
      finalTurns: [{ turnId, transcript, providerSpeakerId }],
    }),
  });

  assert.ok(classifierSpeakers.includes('candidate'));
  assert.ok(!classifierSpeakers.includes('recruiter'));
  assert.ok(!report.recruitingRelease?.gateFailures.includes('runtime_observation_speaker_mismatch'));
});

test('recruiting release gate fails when an expected continuation child or latency sample is missing', async () => {
  const { evaluateRecruitingReleaseQualityGate } = await import(
    pathToFileURL(path.join(repoRoot, 'dist-electron/electron/services/qa/DynamicActionMetricsAggregator.js')).href
  );
  const failures = evaluateRecruitingReleaseQualityGate({
    realMeetingCount: 5,
    labeledFinalTurnCount: 80,
    precision: 1,
    recall: 1,
    overallFalsePositiveRate: 0,
    policyVerificationFalsePositiveRate: 0,
    exclusiveMultiCardRate: 0,
    wrongSpeakerContinuationRate: 0,
    ungroundedPositivePolicyCommitments: 0,
    candidateFacingEvidenceLeaks: 0,
    duplicateDerivedActions: 0,
    unsafeVisibleAnswerCount: 0,
    derivedActionRecall: 0,
    derivedActionFalsePositiveRate: 0,
    derivedActionLatencySampleCount: 0,
    finalTurnToDerivedCardP95Ms: null,
  });
  assert.ok(failures.includes('derived_action_recall'));
  assert.ok(failures.includes('derived_action_latency_sample_missing'));
});

test('real recruiting replay returns a failing exit code before network calls when private assets are blocked', async () => {
  const { runRealSttReplay } = await import('../dynamic-action-real-stt-replay-lib.mjs');
  const previousApiKey = process.env.QCLOUD_LIVE_API_KEY;
  const previousExitCode = process.exitCode;
  process.env.QCLOUD_LIVE_API_KEY = 'preflight-only-test-key';
  process.exitCode = undefined;
  try {
    const result = await runRealSttReplay({
      label: 'Recruiting',
      scriptName: 'test:dynamic-actions:recruiting-replay:real-stt',
      modeTemplateType: 'recruiting',
      outputDirName: 'unused-preflight-test',
      semanticGateMode: 'real',
    });
    assert.equal(result.status, 'BLOCKED_REAL_RECRUITING_ASSETS');
    assert.equal(process.exitCode, 1);
  } finally {
    if (previousApiKey === undefined) delete process.env.QCLOUD_LIVE_API_KEY;
    else process.env.QCLOUD_LIVE_API_KEY = previousApiKey;
    process.exitCode = previousExitCode;
  }
});

test('explicit real recruiting release mode treats missing credentials as a failing block', async () => {
  const { runRealSttReplay } = await import('../dynamic-action-real-stt-replay-lib.mjs');
  const previousQCloudKey = process.env.QCLOUD_LIVE_API_KEY;
  const previousNativeKey = process.env.NATIVELY_API_KEY;
  const previousExitCode = process.exitCode;
  delete process.env.QCLOUD_LIVE_API_KEY;
  delete process.env.NATIVELY_API_KEY;
  process.exitCode = undefined;
  try {
    const result = await runRealSttReplay({
      label: 'Recruiting',
      scriptName: 'test:dynamic-actions:recruiting-replay:real-stt',
      modeTemplateType: 'recruiting',
      outputDirName: 'unused-credentials-test',
      semanticGateMode: 'real',
    });
    assert.equal(result.environmentStatus, 'blocked_missing_credentials');
    assert.equal(process.exitCode, 1);
  } finally {
    if (previousQCloudKey === undefined) delete process.env.QCLOUD_LIVE_API_KEY;
    else process.env.QCLOUD_LIVE_API_KEY = previousQCloudKey;
    if (previousNativeKey === undefined) delete process.env.NATIVELY_API_KEY;
    else process.env.NATIVELY_API_KEY = previousNativeKey;
    process.exitCode = previousExitCode;
  }
});

test('fixture oracle remains deterministic for existing sales and FDE replay modes', async () => {
  const { runDynamicActionReplay } = await import(replayModuleUrl);
  const cases = [
    {
      modeTemplateType: 'sales',
      transcript: 'Your price is too expensive for our budget.',
      expected: { shouldEmit: true, actionType: 'pricing_objection', outputType: 'spoken_response' },
    },
    {
      modeTemplateType: 'fde',
      transcript: 'What API and SSO integration requirements should we validate?',
      expected: { shouldEmit: true, actionType: 'fde_integration_check', outputType: 'spoken_response' },
    },
  ];

  for (const item of cases) {
    const fixture = createReplayFixture(item);
    let injectedCalls = 0;
    const report = await runDynamicActionReplay({
      manifestPath: fixture.manifestPath,
      fixtureRoot: fixture.fixtureRoot,
      audioRoot: fixture.audioRoot,
      outputDir: path.join(fixture.root, 'out'),
      modeTemplateTypes: [item.modeTemplateType],
      semanticGateMode: 'fixture_oracle',
      cloudClassifier: async () => {
        injectedCalls += 1;
        throw new Error('fixture oracle must not call injected classifier');
      },
      transcribeAudio: async () => item.transcript,
    });
    assert.equal(report.failedEntries, 0, item.modeTemplateType);
    assert.equal(injectedCalls, 0, item.modeTemplateType);
  }
});
