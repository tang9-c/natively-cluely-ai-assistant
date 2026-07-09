import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('settings evidence pages keep user-facing labels localized', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  const aiProviders = read('src/components/settings/AIProvidersSettings.tsx');
  const meetingDetails = read('src/components/MeetingDetails.tsx');
  const pdfGenerator = read('src/utils/pdfGenerator.ts');

  for (const [sourceName, source, phrases] of [
    ['SettingsOverlay', settings, [
      'CueUp works with these easy to remember commands.',
      'Restore Default',
      'Capture Screen & Ask AI',
      'Reset / Cancel',
      'Choose the engine that transcribes audio to text.',
      'Same QCLOUD API key · Chinese-first bigmodel with speaker separation',
      'Speaker separation off',
      'Manage input and output devices.',
      'Test Sound',
    ]],
    ['AIProvidersSettings', aiProviders, [
      'Primary model for new chats. Other configured models act as fallbacks.',
      'Add API keys to unlock cloud AI models.',
      'Local Provider (Codex CLI)',
      'Add Provider',
      'Configuration Guide',
      'No custom providers added yet.',
    ]],
    ['MeetingDetails', meetingDetails, ['Follow-up Draft']],
    ['pdfGenerator', pdfGenerator, ['Action Items', 'Key Points', 'Transcript', 'AI Usage & Interactions']],
  ]) {
    for (const phrase of phrases) {
      assert.equal(source.includes(phrase), false, `${sourceName} should not show "${phrase}"`);
    }
  }

  assert.match(settings, /选择用于将音频转写为文字的引擎。/);
  assert.match(settings, /截图并询问 AI/);
  assert.match(aiProviders, /添加 API Key 后即可使用云端 AI 模型。/);
  assert.match(meetingDetails, /跟进草稿/);
  assert.match(pdfGenerator, /AI 使用记录与互动/);
});
