import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module from 'node:module';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function stubElectron(tmpUserData) {
  const cjsRequire = createRequire(import.meta.url);
  const electronId = 'electron';
  const stubModule = new Module(electronId);
  stubModule.exports = {
    app: {
      isReady: () => true,
      getPath: (name) => (name === 'userData' ? tmpUserData : os.tmpdir()),
      getAppPath: () => root,
    },
    shell: { openPath: async () => '' },
  };
  stubModule.loaded = true;
  cjsRequire.cache[electronId] = stubModule;
  try {
    cjsRequire.cache[cjsRequire.resolve(electronId)] = stubModule;
  } catch {
    // Electron is provided by the host test runner.
  }
}

async function loadIntelligenceEngine(tmpUserData) {
  stubElectron(tmpUserData);
  const enginePath = path.join(root, 'dist-electron/electron/IntelligenceEngine.js');
  const trackerPath = path.join(root, 'dist-electron/electron/SessionTracker.js');
  const settingsPath = path.join(root, 'dist-electron/electron/services/SettingsManager.js');

  const engineModule = await import(pathToFileURL(enginePath).href);
  const trackerModule = await import(pathToFileURL(trackerPath).href);
  const settingsModule = await import(pathToFileURL(settingsPath).href);

  settingsModule.SettingsManager.instance = undefined;

  return {
    IntelligenceEngine: engineModule.IntelligenceEngine,
    SessionTracker: trackerModule.SessionTracker,
  };
}

class StubLLMHelper {
  getActiveModel() { return { provider: 'gemini', model: 'gemini-3-flash' }; }
  isStreamingSupported() { return true; }
  setNegotiationCoachingHandler(_fn) { }
  getGeminiClient() { return null; }
  getOpenAIClient() { return null; }
  getClaudeClient() { return null; }
  getGroqClient() { return null; }
  getOllamaClient() { return null; }
  getModesManager() { return { getActiveMode: () => null, getActiveModeSystemPromptSuffix: () => '' }; }
  getSettingsManager() { return { get: () => null, set: () => {} }; }
}

test('runWhatShouldISay resolves active skill before calling WhatToAnswerLLM', async () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-engine-skill-'));
  const { IntelligenceEngine, SessionTracker } = await loadIntelligenceEngine(tmpUserData);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  let capturedActiveSkill = null;
  engine.buildIntentClassificationOptions = () => ({});

  session.addTranscript({
    speaker: 'interviewer',
    text: 'Can you humanize this?',
    timestamp: Date.now(),
    final: true,
  });

  engine.whatToAnswerLLM = {
    async *generateStream(
      _cleanedTranscript,
      _temporalContext,
      _intentResult,
      _imagePaths,
      _screenContext,
      _promptInstruction,
      _uploadedMaterialContext,
      activeSkill,
    ) {
      capturedActiveSkill = activeSkill;
      yield 'answer';
    },
  };

  const answer = await engine.runWhatShouldISay('Can you humanize this?', 0.9, undefined, {
    skipCooldown: true,
  });

  assert.equal(answer, 'answer');
  assert.ok(capturedActiveSkill, 'expected activeSkill to be passed to WhatToAnswerLLM');
  assert.equal(capturedActiveSkill.id, 'humanize-ai-text');
  assert.match(capturedActiveSkill.promptBlock, /<active_skill/);
  engine.reset();
});

test('reset clears trigger-created skill activations', async () => {
  const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-engine-skill-reset-'));
  const { IntelligenceEngine, SessionTracker } = await loadIntelligenceEngine(tmpUserData);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  const captured = [];
  engine.buildIntentClassificationOptions = () => ({});

  engine.whatToAnswerLLM = {
    async *generateStream(
      _cleanedTranscript,
      _temporalContext,
      _intentResult,
      _imagePaths,
      _screenContext,
      _promptInstruction,
      _uploadedMaterialContext,
      activeSkill,
    ) {
      captured.push(activeSkill);
      yield 'answer';
    },
  };

  await engine.runWhatShouldISay('Can you humanize this?', 0.9, undefined, {
    skipCooldown: true,
  });

  assert.ok(captured[0], 'expected trigger to create an ephemeral active skill');

  engine.reset();

  await engine.runWhatShouldISay('What comes next?', 0.9, undefined, {
    skipCooldown: true,
  });

  assert.equal(captured[1], undefined);
});
