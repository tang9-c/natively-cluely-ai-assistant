import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

test('IntelligenceEngine declares and emits skill watcher suggestion event', () => {
  const source = fs.readFileSync(path.join(root, 'electron/IntelligenceEngine.ts'), 'utf8');
  assert.match(source, /skill_watcher_suggestion_created/);
  assert.match(source, /const watcher = SkillWatcherService\.getInstance\(\)/);
  assert.match(source, /const decision = watcher\.evaluate\(\{/);
  assert.match(source, /SkillActivationManager\.getInstance\(\)\.activateSkill/);
  assert.match(source, /this\.emit\(['"]skill_watcher_suggestion_created['"]/);
  assert.match(source, /clearSessionState\(\)/);
});

test('IntelligenceManager forwards skill watcher suggestion event', () => {
  const source = fs.readFileSync(path.join(root, 'electron/IntelligenceManager.ts'), 'utf8');
  assert.match(source, /skill_watcher_suggestion_created/);
});

test('main broadcasts skill watcher suggestions to renderer windows', () => {
  const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
  assert.match(source, /skill_watcher_suggestion_created/);
  assert.match(source, /skill-watcher-suggestion-created/);
  assert.match(source, /this\.broadcast\(['"]skill-watcher-suggestion-created['"]/);
});
