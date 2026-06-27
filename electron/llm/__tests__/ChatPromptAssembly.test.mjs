import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

test('buildChatSystemPrompt preserves base prompt, mode prompt, and active skill order', () => {
  const { buildChatSystemPrompt } = require(path.join(root, 'dist-electron/electron/llm/chatPromptAssembly.js'));
  const prompt = buildChatSystemPrompt({
    basePrompt: 'BASE',
    activeModePrompt: 'MODE',
    activeSkill: {
      id: 'humanize-ai-text',
      name: 'Humanize AI Text',
      promptBlock: '<active_skill id="humanize-ai-text">BODY</active_skill>',
    },
  });

  assert.equal(
    prompt,
    [
      'BASE',
      '## ACTIVE MODE\nMODE',
      [
        '<active_skill>',
        'Skill: Humanize AI Text (humanize-ai-text)',
        '<active_skill id="humanize-ai-text">BODY</active_skill>',
        '</active_skill>',
      ].join('\n'),
    ].join('\n\n'),
  );
});

test('LLMHelper imports and applies shared chat prompt assembly', () => {
  const source = fs.readFileSync(path.join(root, 'electron/LLMHelper.ts'), 'utf8');
  assert.match(source, /buildChatSystemPrompt/);
  assert.match(source, /ChatPromptOptions/);
  assert.match(source, /chatPromptOptions/);
  assert.match(source, /buildProviderSystemPrompt/);
  assert.match(source, /activeSkill/);
});
