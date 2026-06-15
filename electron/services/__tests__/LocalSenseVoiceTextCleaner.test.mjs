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
