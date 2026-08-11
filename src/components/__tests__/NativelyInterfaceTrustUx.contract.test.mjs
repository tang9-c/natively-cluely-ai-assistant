import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('NativelyInterface renders latest answer trust explanation from view model', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /buildLatestAnswerTrustExplanation/);
  assert.match(source, /latestAnswerTrustExplanation/);
  assert.match(source, /primaryMessages/);
  assert.match(source, /degradedMessages/);
  assert.match(source, /latestCitationStatus/);
  assert.match(source, /setLatestCitationStatus/);
  assert.match(source, /baseConfidenceHealthItems/);
  assert.match(source, /latestAnswerTrustExplanation\.primaryMessages/);
  assert.match(source, /latestAnswerTrustExplanation\.degradedMessages/);
  assert.match(source, /sourceStatusFallback:\s*latestChatSourceStatus/);
  assert.match(source, /result\?\.status as CitationStatus/);
  assert.doesNotMatch(source, /latestSourceStatus\?\.uploadedMaterialHitCount && latestSourceStatus\.uploadedMaterialHitCount > 0[\s\S]{0,80}\? `资料命中/);
});

test('NativelyInterface does not expose an always-on recent transcript correction list', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.doesNotMatch(source, /SpeakerCorrectionTranscript/);
  assert.doesNotMatch(source, /speakerCorrectionTranscripts/);
  assert.doesNotMatch(source, /buildSpeakerCorrectionSegmentKey/);
  assert.doesNotMatch(source, /handleSpeakerVerificationSessionOverride/);
  assert.match(preload, /speakerVerificationSetSessionOverride/);
  assert.match(preload, /speaker-verification:set-session-override/);
  assert.match(types, /SpeakerVerificationSessionOverride/);
});

test('speaker verification correction UI lives with dynamic actions instead of raw transcripts', () => {
  const source = read('src/components/NativelyInterface.tsx');
  assert.match(source, /<DynamicActionBar/);
  assert.doesNotMatch(source, /这是我|这不是我/);
});
