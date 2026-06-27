import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

function stubElectron(tmpUserData) {
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = {
    app: {
      isReady: () => true,
      getPath: (name) => (name === 'userData' ? tmpUserData : os.tmpdir()),
    },
    shell: { openPath: async () => '' },
  };
  stubModule.loaded = true;
  require.cache[electronId] = stubModule;
  try {
    require.cache[require.resolve(electronId)] = stubModule;
  } catch {
    // Electron is provided by the host app, not by a disk module in this test.
  }
}

function loadModules(tmpUserData) {
  stubElectron(tmpUserData);

  const activationPath = path.join(root, 'dist-electron/electron/services/SkillActivationManager.js');
  const skillsPath = path.join(root, 'dist-electron/electron/services/SkillsManager.js');
  const settingsPath = path.join(root, 'dist-electron/electron/services/SettingsManager.js');

  delete require.cache[activationPath];
  delete require.cache[skillsPath];
  delete require.cache[settingsPath];

  const activationModule = require(activationPath);
  const skillsModule = require(skillsPath);
  const settingsModule = require(settingsPath);

  activationModule.SkillActivationManager.instance = undefined;
  skillsModule.SkillsManager.instance = undefined;
  settingsModule.SettingsManager.instance = undefined;

  return {
    SkillActivationManager: activationModule.SkillActivationManager,
    SettingsManager: settingsModule.SettingsManager,
  };
}

describe('SkillActivationManager', () => {
  let tmpUserData;
  let SkillActivationManager;
  let SettingsManager;

  beforeEach(() => {
    tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-skill-activation-'));
    ({ SkillActivationManager, SettingsManager } = loadModules(tmpUserData));
  });

  test('resolves default active skill for what_to_answer requests', () => {
    SettingsManager.getInstance().set('defaultActiveSkillIds', ['humanize-ai-text']);
    const manager = SkillActivationManager.getInstance();

    const resolved = manager.resolveActiveSkill({
      requestType: 'what_to_answer',
      latestText: 'How should I answer this?',
      now: 1_000,
    });

    assert.ok(resolved, 'expected default skill to resolve');
    assert.equal(resolved.id, 'humanize-ai-text');
    assert.equal(resolved.activation.scope, 'global_default');
    assert.match(resolved.promptBlock, /<active_skill/);
    assert.match(resolved.promptBlock, /humanize-ai-text/);
  });

  test('ephemeral activation outranks global default and expires', () => {
    SettingsManager.getInstance().set('defaultActiveSkillIds', ['humanize-ai-text']);
    const manager = SkillActivationManager.getInstance();

    manager.activateSkill({
      skillId: 'humanize-ai-text',
      source: 'voice',
      scope: 'ephemeral',
      now: 2_000,
      ttlMs: 60_000,
      reason: 'voice trigger',
    });

    const active = manager.resolveActiveSkill({
      requestType: 'what_to_answer',
      latestText: 'Please help.',
      now: 3_000,
    });
    assert.ok(active);
    assert.equal(active.activation.source, 'voice');
    assert.equal(active.activation.scope, 'ephemeral');

    const expired = manager.resolveActiveSkill({
      requestType: 'what_to_answer',
      latestText: 'Please help.',
      now: 70_001,
    });
    assert.ok(expired);
    assert.equal(expired.activation.scope, 'global_default');
  });

  test('turn activation outranks meeting activation and is single-use', () => {
    const manager = SkillActivationManager.getInstance();

    manager.activateSkill({
      skillId: 'humanize-ai-text',
      source: 'user',
      scope: 'meeting',
      now: 1_000,
      reason: 'meeting preference',
    });
    manager.activateSkill({
      skillId: 'humanize-ai-text',
      source: 'auto',
      scope: 'turn',
      now: 1_100,
      reason: 'current request',
    });

    const first = manager.resolveActiveSkill({
      requestType: 'what_to_answer',
      latestText: 'Make this sound natural.',
      now: 1_200,
    });
    assert.ok(first);
    assert.equal(first.activation.scope, 'turn');

    const second = manager.resolveActiveSkill({
      requestType: 'what_to_answer',
      latestText: 'Next request',
      now: 1_300,
    });
    assert.ok(second);
    assert.equal(second.activation.scope, 'meeting');
  });

  test('clearMeetingActivations removes meeting activations only', () => {
    const manager = SkillActivationManager.getInstance();

    manager.activateSkill({ skillId: 'humanize-ai-text', source: 'user', scope: 'meeting', now: 1_000 });
    manager.activateSkill({ skillId: 'humanize-ai-text', source: 'user', scope: 'session', now: 1_000 });

    manager.clearMeetingActivations();

    const activations = manager.listActivations(2_000);
    assert.equal(activations.some((item) => item.scope === 'meeting'), false);
    assert.equal(activations.some((item) => item.scope === 'session'), true);
  });

  test('detectTrigger recognizes positive phrases and ignores negative phrases', () => {
    const manager = SkillActivationManager.getInstance();

    assert.equal(manager.detectTrigger('Can you humanize this?')?.skillId, 'humanize-ai-text');
    assert.equal(manager.detectTrigger('润色一下这段回答')?.skillId, 'humanize-ai-text');
    assert.equal(manager.detectTrigger('The customer said they want a summary next week.'), null);
    assert.equal(manager.detectTrigger('We discussed humanizing the product roadmap as a metaphor.'), null);
  });

  test('resolved prompt block respects maxPromptTokens and records truncation marker', () => {
    SettingsManager.getInstance().set('defaultActiveSkillIds', ['humanize-ai-text']);
    const manager = SkillActivationManager.getInstance();

    const resolved = manager.resolveActiveSkill({
      requestType: 'what_to_answer',
      latestText: 'How should I answer?',
      now: 1_000,
      maxPromptTokens: 120,
    });

    assert.ok(resolved);
    assert.ok(resolved.promptBlock.length < 1_200, `prompt block too large: ${resolved.promptBlock.length}`);
    assert.match(resolved.promptBlock, /skill_instructions_truncated/);
    assert.match(resolved.promptBlock, /<active_skill/);
    assert.match(resolved.promptBlock, /<\/active_skill>/);
  });

  test('resolves default active skill for chat requests', () => {
    SettingsManager.getInstance().set('defaultActiveSkillIds', ['humanize-ai-text']);
    const manager = SkillActivationManager.getInstance();

    const resolved = manager.resolveActiveSkill({
      requestType: 'chat',
      latestText: 'Please rewrite this line.',
      now: 1_000,
    });

    assert.ok(resolved, 'expected default skill to resolve for chat');
    assert.equal(resolved.id, 'humanize-ai-text');
    assert.equal(resolved.activation.source, 'default');
    assert.equal(resolved.activation.scope, 'global_default');
  });

  test('resolves a turn activation for chat and consumes it once', () => {
    const manager = SkillActivationManager.getInstance();
    manager.activateSkill({
      skillId: 'humanize-ai-text',
      source: 'user',
      scope: 'turn',
      now: 1_000,
    });

    const first = manager.resolveActiveSkill({
      requestType: 'chat',
      latestText: 'Make this sound natural.',
      now: 1_100,
    });
    const second = manager.resolveActiveSkill({
      requestType: 'chat',
      latestText: 'Make another line natural.',
      now: 1_200,
    });

    assert.ok(first, 'expected turn skill to resolve for chat');
    assert.equal(first.id, 'humanize-ai-text');
    assert.equal(first.activation.scope, 'turn');
    assert.equal(second, null);
  });

  test('does not create hotword activations from chat text', () => {
    SettingsManager.getInstance().set('defaultActiveSkillIds', []);
    SettingsManager.getInstance().set('skillsAutoTriggerEnabled', true);
    const manager = SkillActivationManager.getInstance();

    const resolved = manager.resolveActiveSkill({
      requestType: 'chat',
      latestText: 'Can you humanize this answer?',
      now: 1_000,
    });

    assert.equal(resolved, null);
    assert.deepEqual(manager.listActivations(1_100), []);
  });
});
