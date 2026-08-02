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
  assert.match(source, /result\?\.status as CitationStatus/);
  assert.doesNotMatch(source, /latestSourceStatus\?\.uploadedMaterialHitCount && latestSourceStatus\.uploadedMaterialHitCount > 0[\s\S]{0,80}\? `资料命中/);
});

test('NativelyInterface exposes current-session speaker correction controls', () => {
  const source = read('src/components/NativelyInterface.tsx');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(source, /SpeakerCorrectionTranscript/);
  assert.match(source, /speakerCorrectionTranscripts/);
  assert.match(source, /buildSpeakerCorrectionSegmentKey/);
  assert.match(source, /speakerVerificationSetSessionOverride/);
  assert.match(source, /这是我/);
  assert.match(source, /这不是我/);
  assert.match(source, /handleSpeakerVerificationSessionOverride\(segment,\s*'force_me'\)/);
  assert.match(source, /handleSpeakerVerificationSessionOverride\(segment,\s*'force_not_me'\)/);
  assert.match(preload, /speakerVerificationSetSessionOverride/);
  assert.match(preload, /speaker-verification:set-session-override/);
  assert.match(types, /SpeakerVerificationSessionOverride/);
});
