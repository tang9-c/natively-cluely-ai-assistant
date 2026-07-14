import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/textCleaner.js');

async function loadTextCleaner() {
  return import(pathToFileURL(modulePath).href);
}

test('SenseVoice text cleaner removes language emotion and event tags', async () => {
  const { cleanSenseVoiceText } = await loadTextCleaner();

  assert.equal(
    cleanSenseVoiceText('<|zh|><|NEUTRAL|><|Speech|> 你好，欢迎参加会议。'),
    '你好，欢迎参加会议。'
  );
});

test('SenseVoice text cleaner preserves readable mixed Chinese and English text', async () => {
  const { cleanSenseVoiceText } = await loadTextCleaner();

  assert.equal(
    cleanSenseVoiceText('<|zh|><|HAPPY|><|Speech|>我们今天 review the roadmap。 <|/Speech|>'),
    '我们今天 review the roadmap。'
  );
});

test('SenseVoice parser extracts non-neutral emotion while keeping text clean', async () => {
  const { parseSenseVoiceOutput } = await loadTextCleaner();

  assert.deepEqual(
    parseSenseVoiceOutput('<|zh|><|HAPPY|><|Speech|>你好'),
    {
      text: '你好',
      language: 'zh',
      emotion: 'happy',
      events: ['speech'],
    }
  );
});

test('SenseVoice parser hides neutral emotion from UI payload', async () => {
  const { parseSenseVoiceOutput } = await loadTextCleaner();

  assert.deepEqual(
    parseSenseVoiceOutput('<|zh|><|NEUTRAL|><|Speech|>你好'),
    {
      text: '你好',
      language: 'zh',
      events: ['speech'],
    }
  );
});

test('SenseVoice hallucination guard drops short language-drift fragments in Chinese meetings', async () => {
  const { parseSenseVoiceOutput, shouldDropSenseVoiceHallucination } = await loadTextCleaner();

  assert.equal(
    shouldDropSenseVoiceHallucination(
      parseSenseVoiceOutput('<|en|><|NEUTRAL|><|Speech|>There.'),
      { recognitionLanguageKey: 'chinese' },
    ),
    true,
  );
  assert.equal(
    shouldDropSenseVoiceHallucination(
      parseSenseVoiceOutput('<|ja|><|NEUTRAL|><|Speech|>といでね。'),
      { recognitionLanguageKey: 'chinese' },
    ),
    true,
  );
});

test('SenseVoice hallucination guard keeps normal mixed Chinese business terms', async () => {
  const { parseSenseVoiceOutput, shouldDropSenseVoiceHallucination } = await loadTextCleaner();

  assert.equal(
    shouldDropSenseVoiceHallucination(
      parseSenseVoiceOutput('<|zh|><|NEUTRAL|><|Speech|>我们讨论 API、SSO 和 PLM 集成。'),
      { recognitionLanguageKey: 'chinese' },
    ),
    false,
  );
});
