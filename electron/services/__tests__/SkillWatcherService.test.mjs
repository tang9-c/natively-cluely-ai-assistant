import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

const { SkillWatcherService } = require(path.join(root, 'dist-electron/electron/services/SkillWatcherService.js'));

const humanizeSkill = {
  id: 'humanize-ai-text',
  name: 'Humanize AI Text',
  description: 'Rewrite text to sound natural and human.',
  source: 'builtin',
};

test('watcher ignores transcript when disabled', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: false });

  const result = watcher.evaluate({
    now: 10_000,
    transcriptWindow: [{ speaker: 'user', text: 'This sounds like AI text.', timestamp: 10_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'disabled');
  assert.equal(watcher.listSuggestions().length, 0);
});

test('watcher creates high confidence activate decision', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });

  const result = watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'Please humanize this AI sounding answer now.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'activate');
  assert.equal(result.skillId, 'humanize-ai-text');
  assert.ok(result.confidence >= 0.86);
  assert.equal(result.scope, 'ephemeral');
});

test('watcher stores medium confidence suggestion', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });

  const result = watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'suggest');
  assert.equal(watcher.listSuggestions(61_000).length, 1);
  assert.equal(watcher.listSuggestions(61_000)[0].status, 'pending');
});

test('watcher rate limit prevents repeated runs', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });

  watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });
  const result = watcher.evaluate({
    now: 70_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic again.', timestamp: 70_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  assert.equal(result.action, 'ignore');
  assert.equal(result.reason, 'rate_limited');
});

test('accept and dismiss update suggestion state', () => {
  const watcher = new SkillWatcherService();
  watcher.setSettings({ skillsWatcherEnabled: true });
  watcher.evaluate({
    now: 60_000,
    transcriptWindow: [{ speaker: 'user', text: 'That draft sounds a bit robotic.', timestamp: 60_000 }],
    skills: [humanizeSkill],
    activations: [],
  });

  const suggestion = watcher.listSuggestions(61_000)[0];
  assert.equal(watcher.acceptSuggestion(suggestion.id, 61_000)?.status, 'accepted');
  assert.equal(watcher.dismissSuggestion(suggestion.id, 62_000), null);
});
