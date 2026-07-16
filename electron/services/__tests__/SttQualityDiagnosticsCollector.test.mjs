import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const diagnosticsPath = path.resolve('dist-electron/electron/audio/SttQualityDiagnostics.js');
const collectorPath = path.resolve('dist-electron/electron/services/SttQualityDiagnosticsCollector.js');

async function loadDiagnostics() {
  return import(pathToFileURL(diagnosticsPath).href + `?t=${Date.now()}`);
}

async function loadCollector() {
  return import(pathToFileURL(collectorPath).href + `?t=${Date.now()}`);
}

test('sanitizeSttQualityDiagnostic rejects unknown and transcript-like fields', async () => {
  const { sanitizeSttQualityDiagnostic } = await loadDiagnostics();
  assert.equal(sanitizeSttQualityDiagnostic({
    code: 'rest_stt_upload_diagnostics',
    runtimeSessionId: 'run-1',
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
    uploadLatencyMs: 10,
    outputChars: 4,
    duplicateBoundaryDetected: false,
    status: 'completed',
    text: '测试正文',
  }), null);
});

test('collector writes only inside marked isolated quality diagnostics directory', async () => {
  const { SttQualityDiagnosticsCollector, resolveSttQualityAcceptanceContext } = await loadCollector();
  const root = fs.mkdtempSync('/private/tmp/cueup-stt-quality-');
  fs.writeFileSync(path.join(root, '.cueup-stt-quality-isolated'), '');
  const output = path.join(root, 'quality-diagnostics', 'events.jsonl');
  fs.mkdirSync(path.dirname(output), { recursive: true });

  const context = resolveSttQualityAcceptanceContext({
    userDataDir: root,
    diagnosticsPath: output,
  });
  assert.equal(context.enabled, true);

  const collector = new SttQualityDiagnosticsCollector(context);
  collector.write({
    code: 'stt_quality_meeting_mapping',
    runtimeSessionId: 'run-1',
    meetingId: 'meeting-1',
  });

  const written = fs.readFileSync(output, 'utf8').trim();
  assert.match(written, /stt_quality_meeting_mapping/);

  const escaped = resolveSttQualityAcceptanceContext({
    userDataDir: root,
    diagnosticsPath: path.join(root, '..', 'escaped.jsonl'),
  });
  assert.equal(escaped.enabled, false);
});
