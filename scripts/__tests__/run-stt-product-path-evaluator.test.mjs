import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { evaluateProductPath } from '../run-stt-product-path-evaluator.mjs';

function makeFixture() {
  const root = fs.mkdtempSync('/private/tmp/cueup-stt-product-evaluator-');
  const userDataDir = path.join(root, 'user-data');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, '.cueup-stt-quality-isolated'), '');
  fs.writeFileSync(path.join(userDataDir, 'natively.db'), '');
  return { root, userDataDir };
}

test('product-path evaluator writes aggregate metrics without transcript text', async () => {
  const fixture = makeFixture();

  const referenceReport = path.join(fixture.root, 'reference.json');
  const runManifest = path.join(fixture.root, 'run.json');
  const expectations = path.join(fixture.root, 'expectations.json');
  const diagnostics = path.join(fixture.root, 'diagnostics.jsonl');
  const outputDir = path.join(fixture.root, 'reports');
  fs.writeFileSync(referenceReport, JSON.stringify({ referenceText: 'hello product demo' }));
  fs.writeFileSync(runManifest, JSON.stringify([{
    entry: 'sales-real-001',
    meetingId: 'meeting-1',
    clipSha256: 'clip',
    referenceReport,
    referenceWindowId: 'window-1',
  }]));
  fs.writeFileSync(expectations, JSON.stringify([{
    entry: 'sales-real-001',
    modeTemplateType: 'sales',
    speaker: 'interviewer',
    language: 'english',
    shouldEmit: false,
  }]));
  fs.writeFileSync(diagnostics, [
    JSON.stringify({ code: 'stt_quality_meeting_mapping', runtimeSessionId: 'run-1', meetingId: 'meeting-1' }),
    JSON.stringify({
      code: 'rest_stt_upload_diagnostics',
      provider: 'qcloud-stt',
      speaker: 'interviewer',
      segmentSequence: 1,
      trigger: 'speech-ended',
      inputDurationMs: 2000,
      bufferedBytes: 64000,
      inputChunkCount: 1,
      inputChunkBytesMin: 64000,
      inputChunkBytesMedian: 64000,
      inputChunkBytesMax: 64000,
      uploadLatencyMs: 20,
      speechEndToFinalMs: 30,
      outputChars: 18,
      duplicateBoundaryDetected: false,
      status: 'completed',
    }),
  ].join('\n'));

  const { report, outputPath } = await evaluateProductPath({
    userDataDir: fixture.userDataDir,
    runManifest,
    expectationsManifest: expectations,
    diagnosticsJsonl: diagnostics,
    outputDir,
    transcriptRowsByMeeting: {
      'meeting-1': [{
        speaker: 'interviewer',
        speaker_id: null,
        speaker_label: null,
        content: 'hello product demo',
        timestamp_ms: 100,
      }],
    },
  });

  assert.equal(report.status, 'passed');
  assert.equal(report.productPathCharacterErrorRate, 0);
  assert.equal(report.speechEndToFinalP50Ms, 30);
  const persisted = fs.readFileSync(outputPath, 'utf8');
  assert.equal(persisted.includes('hello product demo'), false);
});

test('product-path evaluator fails fixtures contaminated by microphone rows without printing content', async () => {
  const fixture = makeFixture();

  const referenceReport = path.join(fixture.root, 'reference.json');
  const runManifest = path.join(fixture.root, 'run.json');
  const expectations = path.join(fixture.root, 'expectations.json');
  const diagnostics = path.join(fixture.root, 'diagnostics.jsonl');
  const outputDir = path.join(fixture.root, 'reports');
  fs.writeFileSync(referenceReport, JSON.stringify({ referenceText: 'system audio' }));
  fs.writeFileSync(runManifest, JSON.stringify([{
    entry: 'sales-real-002',
    meetingId: 'meeting-2',
    clipSha256: 'clip',
    referenceReport,
    referenceWindowId: 'window-1',
  }]));
  fs.writeFileSync(expectations, JSON.stringify([{
    entry: 'sales-real-002',
    modeTemplateType: 'sales',
    speaker: 'interviewer',
    language: 'english',
    shouldEmit: false,
  }]));
  fs.writeFileSync(diagnostics, JSON.stringify({
    code: 'stt_quality_meeting_mapping',
    runtimeSessionId: 'run-2',
    meetingId: 'meeting-2',
  }));

  const { report, outputPath } = await evaluateProductPath({
    userDataDir: fixture.userDataDir,
    runManifest,
    expectationsManifest: expectations,
    diagnosticsJsonl: diagnostics,
    outputDir,
    transcriptRowsByMeeting: {
      'meeting-2': [
        {
          speaker: 'interviewer',
          speaker_id: null,
          speaker_label: null,
          content: 'system audio',
          timestamp_ms: 100,
        },
        {
          speaker: 'user',
          speaker_id: null,
          speaker_label: null,
          content: 'private microphone text',
          timestamp_ms: 101,
        },
      ],
    },
  });

  assert.equal(report.status, 'failed');
  assert.equal(report.entries[0].unexpectedSpeakerTranscriptCount, 1);
  assert.equal(fs.readFileSync(outputPath, 'utf8').includes('private microphone text'), false);
});
