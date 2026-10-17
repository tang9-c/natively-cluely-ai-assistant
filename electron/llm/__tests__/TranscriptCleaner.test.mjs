import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadTranscriptCleaner() {
  const cleanerPath = path.resolve(__dirname, '../../../dist-electron/electron/llm/transcriptCleaner.js');
  return import(pathToFileURL(cleanerPath).href);
}

const turn = (timestamp, role, text, extra = {}) => ({ role, text, timestamp, ...extra });

describe('transcriptCleaner speaker-aware sparsification', () => {
  test('keeps legacy audio sources unknown when identity evidence is absent', async () => {
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();

    const output = prepareTranscriptForWhatToAnswer([
      turn(1, 'interviewer', 'Can you walk me through the architecture?'),
      turn(2, 'user', 'Yes, the service has a renderer and electron main process.'),
    ], 12);

    assert.equal(output, [
      '[身份未确认]: can you walk me through the architecture?',
      '[身份未确认]: the service has a renderer and electron main process.',
    ].join('\n'));
  });

  test('keeps current trigger and diverse meeting speakers within twelve turns', async () => {
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();

    const turns = [
      turn(1, 'interviewer', 'Jordan opened with pricing context for the rollout.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(2, 'interviewer', 'Priya described the security review requirements.', { speakerId: 's-priya', speakerLabel: 'Priya', providerSpeakerId: '2', diarizationProvider: 'doubao-auc' }),
      turn(3, 'interviewer', 'Mei raised integration ownership and API constraints.', { speakerId: 's-mei', speakerLabel: 'Mei', providerSpeakerId: '3', diarizationProvider: 'doubao-auc' }),
      turn(4, 'interviewer', 'Sam explained support readiness and customer risk.', { speakerId: 's-sam', speakerLabel: 'Sam', providerSpeakerId: '4', diarizationProvider: 'doubao-auc' }),
      turn(5, 'user', 'I can coordinate the rollout plan with product and engineering.', { speakerId: 's-me', speakerLabel: 'Me', speakerIdentityCorrection:{identity:'me',source:'user',correctedAt:1} }),
      turn(6, 'interviewer', 'Taylor summarized procurement timing and legal review.', { speakerId: 's-taylor', speakerLabel: 'Taylor', providerSpeakerId: '5', diarizationProvider: 'doubao-auc' }),
      turn(7, 'interviewer', 'Jordan added another pricing detail for enterprise customers.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(8, 'interviewer', 'Jordan repeated budget sensitivity for this account.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(9, 'interviewer', 'Jordan mentioned implementation timing after approval.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(10, 'interviewer', 'Jordan asked whether discount approval can happen this week.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(11, 'interviewer', 'Jordan wants a clear decision owner before Friday.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(12, 'interviewer', 'Jordan asked for a risk mitigation plan for launch.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(13, 'interviewer', 'Jordan requested a concrete next step for legal and security.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
      turn(14, 'interviewer', 'Jordan said the team needs the answer before tomorrow.', { speakerId: 's-jordan', speakerLabel: 'Jordan', providerSpeakerId: '1', diarizationProvider: 'doubao-auc' }),
    ];

    const output = prepareTranscriptForWhatToAnswer(turns, 12);
    const lines = output.split('\n');

    assert.ok(lines.length <= 12);
    assert.ok(output.includes('[说话人 1]: jordan said the team needs the answer before tomorrow.'));
    assert.ok(output.includes('[说话人 2]: priya described the security review requirements.'));
    assert.ok(output.includes('[说话人 3]: mei raised integration ownership and api constraints.'));
    assert.ok(output.includes('[说话人 4]: sam explained support readiness and customer risk.'));
    assert.ok(output.includes('[说话人 5]: taylor summarized procurement timing and legal review.'));
    assert.ok(output.includes('[ME]: i can coordinate the rollout plan with product and engineering.'));
  });

  test('keeps latest candidate answer in a long interview window', async () => {
    const { prepareTranscriptForWhatToAnswer } = await loadTranscriptCleaner();

    const turns = Array.from({ length: 14 }, (_, index) =>
      turn(index + 1, 'interviewer', `Can you explain project topic number ${index + 1} in detail?`)
    );
    turns.push(turn(15, 'user', 'My latest answer explains the architecture tradeoff and rollout plan.', {speakerIdentityCorrection:{identity:'me',source:'user',correctedAt:1}}));

    const output = prepareTranscriptForWhatToAnswer(turns, 12);

    assert.ok(output.split('\n').length <= 12);
    assert.ok(output.endsWith('[ME]: my latest answer explains the architecture tradeoff and rollout plan.'));
  });
});
