import axios from 'axios';
import 'dotenv/config';
import { createHash, verify as verifySignature } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const semanticGateModuleUrl = pathToFileURL(
  path.join(root, 'dist-electron/electron/services/dynamic-actions/ModeEventClassifier.js'),
).href;

function extractQCloudContent(data) {
  if (typeof data === 'string') return data;
  const content = data?.choices?.[0]?.message?.content ?? data?.content;
  return typeof content === 'string' ? content : '';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function hasCompleteRecruitingLabel(label) {
  return label && typeof label === 'object'
    && typeof label.turnId === 'string'
    && label.turnId.trim().length > 0
    && typeof label.transcriptSha256 === 'string'
    && /^[a-f0-9]{64}$/.test(label.transcriptSha256)
    && !Object.hasOwn(label, 'transcript')
    && !Object.hasOwn(label, 'speakerRole')
    && Object.hasOwn(label, 'expectedActionType')
    && (label.expectedActionType === null || (
      typeof label.expectedActionType === 'string' && label.expectedActionType.trim().length > 0
    ))
    && typeof label.policyGroundingRequired === 'boolean'
    && typeof label.continuationChildExpected === 'boolean';
}

function hasCompleteAttestedObservation(observation) {
  return observation && typeof observation === 'object'
    && typeof observation.meetingId === 'string'
    && typeof observation.turnId === 'string'
    && typeof observation.transcriptSha256 === 'string'
    && typeof observation.providerSpeakerId === 'string'
    && observation.providerSpeakerId.trim().length > 0
    && typeof observation.speakerRole === 'string'
    && observation.speakerRole.trim().length > 0
    && typeof observation.classifierTraceId === 'string'
    && observation.classifierTraceId.trim().length > 0
    && Array.isArray(observation.observedActionTypes)
    && observation.observedActionTypes.every(value => typeof value === 'string')
    && (observation.parentActionId === null || typeof observation.parentActionId === 'string')
    && Array.isArray(observation.childActionIds)
    && observation.childActionIds.every(value => typeof value === 'string' && value.trim().length > 0)
    && Number.isFinite(observation.finalTurnAtMs)
    && Number.isFinite(observation.completedAtMs)
    && observation.completedAtMs >= observation.finalTurnAtMs
    && (observation.childEmittedAtMs === null || (
      Number.isFinite(observation.childEmittedAtMs)
      && observation.childEmittedAtMs >= observation.finalTurnAtMs
      && observation.childEmittedAtMs <= observation.completedAtMs
    ))
    && typeof observation.policyGroundingUsed === 'boolean'
    && typeof observation.positivePolicyCommitment === 'boolean'
    && typeof observation.candidateFacingEvidenceLeak === 'boolean'
    && typeof observation.unsafeVisibleAnswer === 'boolean';
}

export function buildRecruitingReplayDigest({ assets, observations }) {
  const canonicalAssets = assets
    .map(asset => ({
      meetingId: asset.meetingId,
      audioSha256: asset.audioSha256,
      captureId: asset.captureId,
    }))
    .sort((left, right) => left.meetingId.localeCompare(right.meetingId));
  const canonicalObservations = observations
    .map(observation => ({
      meetingId: observation.meetingId,
      turnId: observation.turnId,
      transcriptSha256: observation.transcriptSha256,
      providerSpeakerId: observation.providerSpeakerId,
      speakerRole: observation.speakerRole,
      classifierTraceId: observation.classifierTraceId,
      observedActionTypes: [...observation.observedActionTypes].sort(),
    }))
    .sort((left, right) => `${left.meetingId}:${left.turnId}`.localeCompare(`${right.meetingId}:${right.turnId}`));
  return sha256(JSON.stringify({ assets: canonicalAssets, observations: canonicalObservations }));
}

export function verifyRecruitingReleaseAttestation(document, publicKey) {
  if (!document || typeof document !== 'object' || !document.payload || typeof document.signature !== 'string') {
    return null;
  }
  if (typeof publicKey !== 'string' || !publicKey.trim()) return null;
  try {
    const valid = verifySignature(
      null,
      Buffer.from(JSON.stringify(document.payload)),
      publicKey,
      Buffer.from(document.signature, 'base64'),
    );
    if (!valid) return null;
  } catch {
    return null;
  }
  const payload = document.payload;
  if (payload.source !== 'production_replay' || typeof payload.runId !== 'string' || !payload.runId.trim()) return null;
  if (!Array.isArray(payload.assets) || !Array.isArray(payload.observations)) return null;
  if (payload.replayDigest !== buildRecruitingReplayDigest(payload)) return null;
  return payload;
}

export function evaluateRecruitingRealAssetGate({ entries, audioRoot, attestationDocument, attestationPublicKey }) {
  const attestation = verifyRecruitingReleaseAttestation(attestationDocument, attestationPublicKey);
  const seenAudioPaths = new Set();
  const seenAudioHashes = new Set();
  const seenMeetingIds = new Set();
  const seenTurnIds = new Set();
  const seenTranscriptHashes = new Set();
  const realMeetings = [];
  const invalidReasons = new Set();
  if (!attestation) invalidReasons.add('trusted_attestation_missing_or_invalid');
  const attestedAssets = new Map();
  const attestedObservations = new Map();
  const attestedCaptureIds = new Set();
  const attestedClassifierTraceIds = new Set();
  for (const asset of attestation?.assets ?? []) {
    if (!asset || typeof asset.meetingId !== 'string' || typeof asset.audioSha256 !== 'string'
      || typeof asset.captureId !== 'string' || !asset.captureId.trim()) {
      invalidReasons.add('invalid_attested_asset');
      continue;
    }
    if (attestedAssets.has(asset.meetingId)) invalidReasons.add('duplicate_attested_meeting_id');
    if (attestedCaptureIds.has(asset.captureId)) invalidReasons.add('duplicate_attested_capture_id');
    attestedCaptureIds.add(asset.captureId);
    attestedAssets.set(asset.meetingId, asset);
  }
  for (const observation of attestation?.observations ?? []) {
    if (!hasCompleteAttestedObservation(observation)) {
      invalidReasons.add('invalid_attested_observation');
      continue;
    }
    const key = `${observation.meetingId}:${observation.turnId}`;
    if (attestedObservations.has(key)) invalidReasons.add('duplicate_attested_observation');
    if (attestedClassifierTraceIds.has(observation.classifierTraceId)) {
      invalidReasons.add('duplicate_classifier_trace_id');
    }
    attestedClassifierTraceIds.add(observation.classifierTraceId);
    attestedObservations.set(key, observation);
  }
  for (const entry of entries) {
    if (entry.modeTemplateType !== 'recruiting' || entry.syntheticAudio === true) continue;
    if (entry.syntheticAudio !== false) {
      invalidReasons.add('synthetic_flag_not_explicit');
      continue;
    }
    const audioPath = path.isAbsolute(entry.audioPath)
      ? entry.audioPath
      : path.resolve(audioRoot, entry.audioPath);
    const provenance = entry.realAsset;
    const attestedAsset = provenance?.meetingId ? attestedAssets.get(provenance.meetingId) : undefined;
    let meetingValid = true;
    if (!fs.existsSync(audioPath)) {
      invalidReasons.add('audio_missing');
      meetingValid = false;
    }
    if (seenAudioPaths.has(audioPath)) {
      invalidReasons.add('duplicate_audio_path');
      meetingValid = false;
    }
    seenAudioPaths.add(audioPath);
    if (provenance?.sourceKind !== 'real_recording'
      || typeof provenance.meetingId !== 'string'
      || !provenance.meetingId.trim()
      || typeof provenance.audioSha256 !== 'string') {
      invalidReasons.add('invalid_real_asset_provenance');
      meetingValid = false;
    } else {
      if (seenMeetingIds.has(provenance.meetingId)) {
        invalidReasons.add('duplicate_meeting_id');
        meetingValid = false;
      }
      seenMeetingIds.add(provenance.meetingId);
      if (!attestedAsset || attestedAsset.audioSha256 !== provenance.audioSha256) {
        invalidReasons.add('asset_not_in_trusted_attestation');
        meetingValid = false;
      }
      const actualAudioSha256 = fs.existsSync(audioPath) ? sha256(fs.readFileSync(audioPath)) : null;
      if (actualAudioSha256 !== provenance.audioSha256) {
        invalidReasons.add('audio_sha256_mismatch');
        meetingValid = false;
      }
      if (seenAudioHashes.has(provenance.audioSha256)) {
        invalidReasons.add('duplicate_audio_sha256');
        meetingValid = false;
      }
      seenAudioHashes.add(provenance.audioSha256);
    }

    const labels = Array.isArray(entry.labeledFinalTurns) ? entry.labeledFinalTurns : [];
    if (labels.length === 0) {
      invalidReasons.add('missing_final_turn_labels');
      meetingValid = false;
    }
    for (const label of labels) {
      if (!hasCompleteRecruitingLabel(label)) {
        invalidReasons.add('invalid_final_turn_label');
        meetingValid = false;
      }
      if (typeof label?.turnId === 'string') {
        if (seenTurnIds.has(label.turnId)) {
          invalidReasons.add('duplicate_turn_id');
          meetingValid = false;
        }
        seenTurnIds.add(label.turnId);
      }
      if (typeof label?.transcriptSha256 === 'string') {
        if (seenTranscriptHashes.has(label.transcriptSha256)) {
          invalidReasons.add('duplicate_transcript_sha256');
          meetingValid = false;
        }
        seenTranscriptHashes.add(label.transcriptSha256);
      }
      const observation = provenance?.meetingId && label?.turnId
        ? attestedObservations.get(`${provenance.meetingId}:${label.turnId}`)
        : undefined;
      if (!observation || observation.transcriptSha256 !== label?.transcriptSha256) {
        invalidReasons.add('attested_observation_missing_or_mismatched');
        meetingValid = false;
      }
    }
    if (meetingValid) {
      realMeetings.push(entry);
    }
  }
  const availableLabeledFinalTurns = realMeetings.reduce(
    (count, entry) => count + entry.labeledFinalTurns.length,
    0,
  );
  const coverage = {
    requiredRealMeetings: 5,
    availableRealMeetings: realMeetings.length,
    requiredLabeledFinalTurns: 80,
    availableLabeledFinalTurns,
  };
  return {
    status: invalidReasons.size === 0
      && realMeetings.length >= coverage.requiredRealMeetings
      && availableLabeledFinalTurns >= coverage.requiredLabeledFinalTurns
      ? 'ready'
      : 'BLOCKED_REAL_RECRUITING_ASSETS',
    ...coverage,
    invalidReasons: [...invalidReasons].sort(),
  };
}

export function createQCloudReplaySemanticClassifier({ apiKey, endpoint, model, post }) {
  const authorization = `Bearer ${apiKey.trim()}`;
  return async input => {
    const {
      buildCloudSemanticGatePrompt,
      CloudSemanticGateError,
      cloudFailureReasonFromError,
      parseCloudSemanticGateResponse,
    } = await import(semanticGateModuleUrl);
    try {
      const response = await post(endpoint, {
        model,
        messages: [{ role: 'user', content: buildCloudSemanticGatePrompt(input) }],
        max_tokens: 256,
      }, {
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
        },
        timeout: 2500,
      });
      return parseCloudSemanticGateResponse(extractQCloudContent(response.data), input.candidates);
    } catch (error) {
      throw new CloudSemanticGateError(cloudFailureReasonFromError(error));
    }
  };
}

export function usage(label, scriptName) {
  console.log(`${label} real STT replay

Usage:
  QCLOUD_LIVE_API_KEY=... npm run ${scriptName}
  NATIVELY_API_KEY=... npm run ${scriptName}

Options:
  --poll-interval-ms <n>   Poll interval, default 2000
  --max-attempts <n>       Max query attempts, default 60
  --help                   Show this help

Notes:
  - This makes real network requests and may incur STT usage cost.
  - Real recruiting release runs also require RECRUITING_RELEASE_ATTESTATION_PATH and RECRUITING_RELEASE_ATTESTATION_PUBLIC_KEY_PATH.
  - API keys are read from environment variables and are never printed.`);
}

export function parseArgs(argv, label, scriptName) {
  const opts = {
    pollIntervalMs: 2000,
    maxAttempts: 60,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      usage(label, scriptName);
      process.exit(0);
    }
    if (arg === '--poll-interval-ms') {
      opts.pollIntervalMs = Number(argv[++i]);
      continue;
    }
    if (arg === '--max-attempts') {
      opts.maxAttempts = Number(argv[++i]);
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(opts.pollIntervalMs) || opts.pollIntervalMs < 0) {
    throw new Error('--poll-interval-ms must be a non-negative number');
  }
  if (!Number.isInteger(opts.maxAttempts) || opts.maxAttempts <= 0) {
    throw new Error('--max-attempts must be a positive integer');
  }
  return opts;
}

export async function runRealSttReplay({
  label,
  scriptName,
  modeTemplateType,
  outputDirName,
  semanticGateMode = 'fixture_oracle',
}) {
  const opts = parseArgs(process.argv.slice(2), label, scriptName);
  const apiKey = process.env.QCLOUD_LIVE_API_KEY || process.env.NATIVELY_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    const missingCredentialsReport = {
      environmentStatus: 'blocked_missing_credentials',
      status: 'blocked',
      reason: `Missing QCLOUD_LIVE_API_KEY or NATIVELY_API_KEY for ${label} real STT replay.`,
      modeTemplateTypes: [modeTemplateType],
    };
    console.log(JSON.stringify(missingCredentialsReport, null, 2));
    if (modeTemplateType === 'recruiting' && semanticGateMode === 'real') {
      process.exitCode = 1;
      return missingCredentialsReport;
    }
    process.exit(0);
  }

  const manifestPath = path.join(root, 'tests/fixtures/dynamic-actions/replay/replay-manifest.json');
  let recruitingReleaseAttestationDocument;
  let recruitingReleaseAttestationPublicKey;
  if (modeTemplateType === 'recruiting' && semanticGateMode === 'real') {
    const entries = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    const attestationPath = process.env.RECRUITING_RELEASE_ATTESTATION_PATH;
    const attestationPublicKeyPath = process.env.RECRUITING_RELEASE_ATTESTATION_PUBLIC_KEY_PATH;
    let attestationDocument;
    let attestationPublicKey;
    if (attestationPath && fs.existsSync(attestationPath)) {
      try {
        attestationDocument = JSON.parse(fs.readFileSync(attestationPath, 'utf8'));
      } catch {
        attestationDocument = undefined;
      }
    }
    if (attestationPublicKeyPath && fs.existsSync(attestationPublicKeyPath)) {
      attestationPublicKey = fs.readFileSync(attestationPublicKeyPath, 'utf8');
    }
    const assetGate = evaluateRecruitingRealAssetGate({
      entries,
      audioRoot: root,
      attestationDocument,
      attestationPublicKey,
    });
    if (assetGate.status !== 'ready') {
      const blockedReport = {
        environmentStatus: 'blocked_real_recruiting_assets',
        ...assetGate,
        syntheticAssetsCountTowardGate: false,
      };
      console.log(JSON.stringify(blockedReport, null, 2));
      process.exitCode = 1;
      return blockedReport;
    }
    recruitingReleaseAttestationDocument = attestationDocument;
    recruitingReleaseAttestationPublicKey = attestationPublicKey;
  }

  const replayModuleUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/services/qa/DynamicActionReplayRunner.js'),
  ).href;
  const aucClientUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/audio/doubaoAucClient.js'),
  ).href;
  const constantsUrl = pathToFileURL(
    path.join(root, 'dist-electron/electron/llm/QCloudLlmConstants.js'),
  ).href;

  const { runDynamicActionReplay } = await import(replayModuleUrl);
  const {
    extractDoubaoAucTranscriptionJson,
    transcribeNewApiDoubaoAucMultipartFile,
  } = await import(aucClientUrl);
  const {
    QCLOUD_CHAT_COMPLETIONS_ENDPOINT,
    QCLOUD_CHAT_MODEL,
    QCLOUD_STT_QUERY_ENDPOINT,
    QCLOUD_STT_SUBMIT_ENDPOINT,
  } = await import(constantsUrl);

  async function post(url, body, options) {
    const response = await axios.post(url, body, {
      headers: options.headers,
      timeout: options.timeout,
      validateStatus: () => true,
    });
    if (response.status >= 400) {
      throw new Error(`QCLOUD API STT HTTP ${response.status}`);
    }
    return { data: response.data, headers: response.headers };
  }

  async function transcribeAudio(audioPath, entry) {
    const audioBuffer = fs.readFileSync(audioPath);
    const serialized = await transcribeNewApiDoubaoAucMultipartFile({
      submitEndpoint: QCLOUD_STT_SUBMIT_ENDPOINT,
      queryEndpoint: QCLOUD_STT_QUERY_ENDPOINT,
      authHeader: { Authorization: `Bearer ${apiKey.trim()}` },
      audioBuffer,
      filename: path.basename(audioPath),
      contentType: 'audio/wav',
      formFields: {
        model: 'bigmodel',
        enable_speaker_info: 'true',
        enable_emotion_detection: 'true',
        show_utterances: 'true',
        enable_itn: 'true',
      },
      extractTranscript: extractDoubaoAucTranscriptionJson,
      post,
      pollIntervalMs: opts.pollIntervalMs,
      maxAttempts: opts.maxAttempts,
    });
    const transcription = JSON.parse(serialized);
    const meetingId = entry.realAsset?.meetingId ?? entry.id;
    return {
      text: transcription.text,
      finalTurns: transcription.utterances.map((utterance, index) => ({
        turnId: `${meetingId}-turn-${index + 1}`,
        transcript: utterance.text,
        providerSpeakerId: utterance.providerSpeakerId ?? '',
      })),
    };
  }

  const cloudClassifier = semanticGateMode === 'real'
    ? createQCloudReplaySemanticClassifier({
        apiKey,
        endpoint: QCLOUD_CHAT_COMPLETIONS_ENDPOINT,
        model: QCLOUD_CHAT_MODEL,
        post,
      })
    : undefined;

  const report = await runDynamicActionReplay({
    manifestPath,
    outputDir: path.join(root, 'reports', outputDirName),
    audioRoot: root,
    modeTemplateTypes: [modeTemplateType],
    semanticGateMode,
    cloudClassifier,
    recruitingReleaseAttestationDocument,
    recruitingReleaseAttestationPublicKey,
    environmentStatus: 'ok',
    transcribeAudio: async ({ entry, audioPath }) => transcribeAudio(audioPath, entry),
  });

  console.log(JSON.stringify(report, null, 2));
  if (modeTemplateType === 'recruiting' && semanticGateMode === 'real') {
    const gateFailures = report.recruitingRelease?.gateFailures;
    if (!Array.isArray(gateFailures) || gateFailures.length > 0) {
      console.error(`[${label} real STT replay] Recruiting release gate failed: ${
        Array.isArray(gateFailures) ? gateFailures.join(', ') : 'release_metrics_missing'
      }`);
      process.exitCode = 1;
    }
  }
  if (report.assetCoverageFailures?.length > 0) {
    console.error(`[${label} real STT replay] Missing required real audio assets: ${report.assetCoverageFailures
      .map((failure) => `${failure.modeTemplateType} ${failure.availableReal}/${failure.requiredReal} real assets`)
      .join(', ')}`);
    if (modeTemplateType === 'recruiting') {
      console.error('BLOCKED_REAL_RECRUITING_ASSETS');
    }
  }
  if (report.failedEntries > 0 || report.skippedEntries > 0) process.exit(1);
  return report;
}
