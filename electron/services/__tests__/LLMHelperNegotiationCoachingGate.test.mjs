// Issue #272 — verify LLMHelper gates the live-negotiation coaching short-circuit
// by the active ModesManager template. The premium negotiation tracker fires on
// any interviewer utterance regardless of active mode, so without this gate a
// technical-interview / team-meet / lecture user can have their "what to answer"
// stream replaced by a salary-coaching card.
//
// We exercise the compiled JS in dist-electron so the test runs against the
// same code path the Electron main process loads. The setup:
//   1. Stub the `electron` module (LLMHelper -> ModelVersionManager depends on
//      `app.getPath('userData')` during construction).
//   2. Stub knowledgeOrchestrator so isKnowledgeMode() returns true and
//      processQuestion() returns a payload with liveNegotiationResponse.
//   3. Patch ModesManager.getInstance().getActiveMode to return a specific
//      template (same singleton-patching pattern used by ModesManager.test.mjs).
//   4. Drive both streamChat and chatWithGemini and observe whether the
//      negotiation coaching handler was called.
//
// Expected:
//   - For modes where coaching is contextually appropriate
//     (looking-for-work, sales, recruiting, general, no-active-mode):
//     handler IS invoked AND the function short-circuits (no provider call).
//   - For modes where coaching would clobber the answer
//     (technical-interview, team-meet, lecture):
//     handler is NOT invoked. The function falls through to normal LLM
//     dispatch which, with no providers configured, will throw — we catch
//     that and assert only on the handler-invocation flag.

import { test, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import Module from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

// The default `npm run build:electron` produces a single esbuild bundle per
// entry point, which inlines ModesManager into LLMHelper. That makes the
// internal singleton unreachable from outside, so we cannot patch
// getActiveMode to drive the gate. To keep the test hermetic we compile a
// per-file CJS tree just for this test where LLMHelper still resolves
// ModesManager via Node's CJS cache.
const distDir = (() => {
  const bundledLLMHelper = path.resolve(repoRoot, 'dist-electron/electron/LLMHelper.js');
  const isBundled = fs.existsSync(bundledLLMHelper) &&
    fs.readFileSync(bundledLLMHelper, 'utf8').includes('init_ModesManager');
  if (!isBundled) return path.resolve(repoRoot, 'dist-electron');

  const target = path.resolve(repoRoot, 'dist-electron-test-isolated');
  // Only re-emit when missing or when our two source files are newer than the
  // compiled outputs — keep the test cheap on the happy path.
  const llmTsMtime = fs.statSync(path.resolve(repoRoot, 'electron/LLMHelper.ts')).mtimeMs;
  const modesTsMtime = fs.statSync(path.resolve(repoRoot, 'electron/services/ModesManager.ts')).mtimeMs;
  const compiledLLM = path.join(target, 'electron/LLMHelper.js');
  const compiledModes = path.join(target, 'electron/services/ModesManager.js');
  const stale = !fs.existsSync(compiledLLM) || !fs.existsSync(compiledModes) ||
    fs.statSync(compiledLLM).mtimeMs < llmTsMtime ||
    fs.statSync(compiledModes).mtimeMs < modesTsMtime;
  if (stale) {
    // tsc exits non-zero on pre-existing type errors in unrelated test files,
    // but still emits JS for files that compile cleanly. We swallow the
    // non-zero status and verify post-hoc that LLMHelper.js was produced.
    try {
      execSync(`node node_modules/.bin/tsc -p electron/tsconfig.json --outDir ${target}`, {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (_tscErr) {
      // expected — tsc returns 1 on type errors elsewhere
    }
  }
  if (!fs.existsSync(path.join(target, 'electron/LLMHelper.js'))) {
    throw new Error('tsc emission failed — LLMHelper.js missing from isolated tree');
  }
  return target;
})();

const llmHelperPath = path.resolve(distDir, 'electron/LLMHelper.js');
const modesPath = path.resolve(distDir, 'electron/services/ModesManager.js');

const cjsRequire = createRequire(import.meta.url);

// --- Electron stub ----------------------------------------------------------
// ModelVersionManager is now static (no disk access), but other modules may
// still need electron.app. Keep the stub minimal.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'llmhelper-gate-test-'));
const electronStub = {
  app: {
    isReady: () => true,
    getPath: name => (name === 'userData' ? tmpUserData : os.tmpdir()),
    getName: () => 'natively-test',
    getVersion: () => '0.0.0-test',
  },
  shell: { openPath: async () => '' },
  ipcMain: { on: () => {}, handle: () => {}, removeAllListeners: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
};

const electronStubModule = new Module('electron');
electronStubModule.exports = electronStub;
electronStubModule.loaded = true;
cjsRequire.cache.electron = electronStubModule;
try { cjsRequire.cache[cjsRequire.resolve('electron')] = electronStubModule; } catch { /* no on-disk electron in this env */ }

// Same singleton, both here and inside compiled LLMHelper's
// `require('./services/ModesManager')`, because Node's CJS cache keys by
// resolved path.
const { ModesManager } = cjsRequire(modesPath);
const { LLMHelper } = cjsRequire(llmHelperPath);

const PAYLOAD_SENTINEL = { phase: 'gate-test', amount: '$0', tone: 'firm' };

function installActiveMode(templateType) {
  const manager = ModesManager.getInstance();
  manager.getActiveMode = () => {
    if (!templateType) return null;
    return {
      id: `${templateType}-mode`,
      name: templateType,
      templateType,
      customContext: '',
      isActive: true,
      createdAt: '2026-05-26T00:00:00.000Z',
    };
  };
  // Neutralize mode-context injection that runs AFTER the gate so the
  // streaming path doesn't try to retrieve real reference files.
  manager.getActiveModeSystemPromptSuffix = () => '';
  manager.buildRetrievedActiveModeContextBlock = () => '';
  manager.buildActiveModeContextBlock = () => '';
  return manager;
}

function buildHelper() {
  // No API keys, no Ollama -> no provider client branches taken. The gate is
  // checked BEFORE any provider dispatch, so the early-return / fall-through
  // behavior is observable without making a network call.
  return new LLMHelper(undefined, false);
}

function buildOrchestratorStub(opts = {}) {
  const feedCalls = [];
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: msg => feedCalls.push(msg),
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      liveNegotiationResponse: opts.payload ?? PAYLOAD_SENTINEL,
    }),
    feedCalls,
  };
}

async function drainStream(generator) {
  // We don't care about chunks — only whether processQuestion's payload was
  // forwarded to the negotiation handler before/instead of provider dispatch.
  // Provider dispatch with no clients will throw; swallow so the assertion
  // about handler invocation is what fails the test, not unconfigured deps.
  const chunks = [];
  try {
    for await (const chunk of generator) chunks.push(chunk);
  } catch (_err) {
    // expected when the gate blocks and we fall through to provider dispatch
  }
  return chunks;
}

async function callChat(helper, message) {
  try {
    return await helper.chatWithGemini(message, undefined, undefined, true);
  } catch (_err) {
    return null;
  }
}

beforeEach(() => {
  installActiveMode(null);
});

test('streamChat: handler IS invoked when active mode allows coaching (looking-for-work)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  const chunks = await drainStream(helper.streamChat('What salary should I ask for?'));

  assert.equal(captured.length, 1, 'handler must fire once for looking-for-work');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  // Early-return — no normal stream tokens.
  assert.deepEqual(chunks, []);
});

test('streamChat: handler IS invoked when no active mode is set (default-open)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode(null);
  const chunks = await drainStream(helper.streamChat('Any salary thoughts?'));

  assert.equal(captured.length, 1, 'handler must fire when no mode is active');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  assert.deepEqual(chunks, []);
});

test('streamChat: handler is NOT invoked when active mode is technical-interview (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('technical-interview');
  await drainStream(helper.streamChat('Walk me through your last system design.'));

  assert.equal(
    captured.length,
    0,
    'technical-interview must NEVER receive a salary card mid-answer (issue #272)',
  );
});

test('streamChat: handler is NOT invoked for team-meet or lecture either', async () => {
  for (const templateType of ['team-meet', 'lecture']) {
    const helper = buildHelper();
    helper.setKnowledgeOrchestrator(buildOrchestratorStub());
    const captured = [];
    helper.setNegotiationCoachingHandler(payload => captured.push(payload));

    installActiveMode(templateType);
    await drainStream(helper.streamChat('any input?'));

    assert.equal(
      captured.length,
      0,
      `${templateType} must NOT trigger a salary-coaching card (issue #272)`,
    );
  }
});

test('streamChat: handler IS invoked for the remaining coaching-eligible modes', async () => {
  for (const templateType of ['sales', 'recruiting', 'general']) {
    const helper = buildHelper();
    helper.setKnowledgeOrchestrator(buildOrchestratorStub());
    const captured = [];
    helper.setNegotiationCoachingHandler(payload => captured.push(payload));

    installActiveMode(templateType);
    await drainStream(helper.streamChat('compensation discussion'));

    assert.equal(
      captured.length,
      1,
      `${templateType} should still allow coaching short-circuit`,
    );
    assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  }
});

// Symmetry check for the non-streaming path — same gate at LLMHelper.ts:~1354.
// Cheap to exercise: chatWithGemini's gate is structurally identical.
test('chatWithGemini: handler IS invoked when active mode allows coaching', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  const result = await callChat(helper, 'What salary should I ask for?');

  assert.equal(captured.length, 1, 'chatWithGemini must fire handler for looking-for-work');
  assert.deepEqual(captured[0], PAYLOAD_SENTINEL);
  // chatWithGemini returns '' on the coaching short-circuit branch.
  assert.equal(result, '');
});

test('chatWithGemini: handler is NOT invoked when active mode is technical-interview', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildOrchestratorStub());
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('technical-interview');
  await callChat(helper, 'Explain consistent hashing.');

  assert.equal(
    captured.length,
    0,
    'technical-interview must block the coaching short-circuit on the non-streaming path too (issue #272)',
  );
});

// ---------------------------------------------------------------------------
// Broader gate coverage (issue #272 follow-up). The gate suppresses the
// short-circuit behaviors (coaching / canned intro) for templates where they
// are contextually wrong, but request-scoped profile/scenario context should
// still be allowed so Profile Intelligence materials can ground normal answers.
// ---------------------------------------------------------------------------

function buildIntroOrchestratorStub() {
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      isIntroQuestion: true,
      introResponse: 'CANNED_INTRO_RESPONSE_SENTINEL',
    }),
  };
}

function buildInjectionOrchestratorStub() {
  return {
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      systemPromptInjection: 'PREMIUM_PROMPT_SENTINEL',
      contextBlock: 'PREMIUM_CONTEXT_SENTINEL',
    }),
  };
}

test('streamChat: intro shortcut FIRES in looking-for-work mode (regression guard)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('looking-for-work');
  const chunks = await drainStream(helper.streamChat('Tell me about yourself.'));

  assert.ok(
    chunks.includes('CANNED_INTRO_RESPONSE_SENTINEL'),
    'intro shortcut must still fire in modes where it is appropriate',
  );
});

test('streamChat: intro shortcut is SUPPRESSED in technical-interview (issue #272)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('technical-interview');
  const chunks = await drainStream(helper.streamChat('Walk me through your last project.'));

  assert.ok(
    !chunks.includes('CANNED_INTRO_RESPONSE_SENTINEL'),
    'technical-interview must NOT emit a canned intro response (sibling of issue #272)',
  );
});

test('chatWithGemini: intro shortcut is SUPPRESSED in lecture mode', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildIntroOrchestratorStub());

  installActiveMode('lecture');
  const result = await callChat(helper, 'Tell me about yourself.');

  assert.notEqual(
    result,
    'CANNED_INTRO_RESPONSE_SENTINEL',
    'lecture mode must NOT short-circuit to a canned intro (sibling of issue #272)',
  );
});

// Helper to wire a fake customProvider + spy on the dispatch so we can read
// the resolved (system, context) at the point streamChat/chatWithGemini hand
// off to a provider. This is what makes the prompt/context-injection tests
// falsifiable — without it the dispatch path throws on no-client before we
// can observe the resolved values, and the negative assertion passes
// vacuously whether the gate is in place or not.
function attachDispatchSpy(helper) {
  helper.customProvider = {
    id: 'spy-provider',
    name: 'spy',
    curlCommand: 'noop',
  };
  // Neutralize the provider-data-scope filter so the context the intercept
  // injected actually reaches the dispatch arg. Without this stub the
  // chatWithGemini path applies `shouldOmitContext ? "" : context` and the
  // sentinel gets stripped by an unrelated mechanism, making the assertion
  // unfalsifiable.
  helper.getDeniedOutboundScopes = () => [];
  const calls = [];
  // streamChat path → streamWithCustom (async generator yielding chunks)
  helper.streamWithCustom = async function* (message, context, _imagePaths, systemPrompt) {
    calls.push({ via: 'streamWithCustom', message, context: context || '', systemPrompt: systemPrompt || '' });
    yield '';
  };
  // chatWithGemini path → executeCustomProvider
  helper.executeCustomProvider = async function (_cmd, combinedMessage, systemPrompt, message, context, _img) {
    calls.push({ via: 'executeCustomProvider', message, context: context || '', systemPrompt: systemPrompt || '', combinedMessage: combinedMessage || '' });
    return 'spy-response';
  };
  return calls;
}

test('streamChat: premium context block REACHES dispatch in looking-for-work (positive control)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('looking-for-work');
  await drainStream(helper.streamChat('Talk through your career story.'));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached after the intercept');
  // The premium context block is prepended to the (initially empty) context by
  // the intercept body. Its presence at dispatch proves the intercept ran.
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `looking-for-work must inject premium context at dispatch; saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
});

test('streamChat: knowledge context skips duplicate mode retrieval but keeps the mode prompt', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);
  const manager = installActiveMode('sales');
  let retrievalCalls = 0;
  manager.getActiveModeSystemPromptSuffix = () => 'ACTIVE_MODE_SUFFIX_SENTINEL';
  manager.buildRetrievedActiveModeContextBlock = () => {
    retrievalCalls += 1;
    return 'DUPLICATE_MODE_CONTEXT_SENTINEL';
  };

  await drainStream(helper.streamChat('客户问题'));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached after the intercept');
  assert.equal(retrievalCalls, 0, 'knowledge context already contains mode RAG and must not retrieve it again');
  assert.equal(dispatched.context.includes('DUPLICATE_MODE_CONTEXT_SENTINEL'), false);
  assert.match(dispatched.context, /PREMIUM_CONTEXT_SENTINEL/);
  assert.match(dispatched.systemPrompt, /ACTIVE_MODE_SUFFIX_SENTINEL/);
});

test('streamChat: profile/scenario context block still reaches dispatch in technical-interview', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('technical-interview');
  await drainStream(helper.streamChat('Discuss CAP theorem.'));

  const dispatched = calls.find(c => c.via === 'streamWithCustom');
  assert.ok(dispatched, 'streamWithCustom must be reached after fall-through');
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `technical-interview must still inject request-scoped profile/scenario context; saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
  assert.ok(
    dispatched.systemPrompt.includes('PREMIUM_PROMPT_SENTINEL'),
    `technical-interview must still inject request-scoped scenario system prompt; saw systemPrompt=${JSON.stringify(dispatched.systemPrompt).slice(0, 200)}`,
  );
});

// callChat in the rest of the file pins skipSystemPrompt=true, which is
// correct for the coaching/intro tests — those short-circuit BEFORE the
// systemPromptInjection block. For prompt/context-injection tests we need
// skipSystemPrompt=false so the injection block (gated on !skipSystemPrompt
// && knowledgeResult.systemPromptInjection in chatWithGemini) actually runs.
async function callChatWithSystem(helper, message) {
  try {
    return await helper.chatWithGemini(message, undefined, undefined, false);
  } catch (_err) {
    return null;
  }
}

test('chatWithGemini: profile/scenario context block reaches dispatch in team-meet', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('team-meet');
  const result = await callChatWithSystem(helper, 'Project status?');

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached after fall-through');
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    'team-meet must still inject request-scoped profile/scenario context',
  );
  assert.ok(
    dispatched.combinedMessage.includes('PREMIUM_PROMPT_SENTINEL'),
    'team-meet must still inject request-scoped scenario system prompt into the combined message',
  );
  // Sanity: the spy actually returned something rather than the function
  // erroring out before reaching dispatch.
  assert.equal(result, 'spy-response', 'dispatch must have produced the spy response');
});

test('chatWithGemini: premium context block REACHES dispatch in recruiting (positive control)', async () => {
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator(buildInjectionOrchestratorStub());
  const calls = attachDispatchSpy(helper);

  installActiveMode('recruiting');
  await callChatWithSystem(helper, 'How did the candidate respond?');

  const dispatched = calls.find(c => c.via === 'executeCustomProvider');
  assert.ok(dispatched, 'executeCustomProvider must be reached after the intercept');
  assert.ok(
    dispatched.context.includes('PREMIUM_CONTEXT_SENTINEL'),
    `recruiting must inject premium context at dispatch; saw context=${JSON.stringify(dispatched.context).slice(0, 200)}`,
  );
});

test('streamChat: premium prompt injection STILL FIRES in looking-for-work (regression guard)', async () => {
  // We can't see the injected prompt directly (it goes into the next LLM call
  // which we don't reach). But the intercept's other gated behaviors firing
  // is sufficient proof — we already verified coaching fires for
  // looking-for-work. Inverse coverage: confirm the intercept body still
  // executes by stubbing processQuestion to ALSO emit coaching so we can
  // observe handler invocation as proof the body ran.
  const helper = buildHelper();
  helper.setKnowledgeOrchestrator({
    isKnowledgeMode: () => true,
    feedForDepthScoring: () => {},
    feedInterviewerUtterance: () => {},
    processQuestion: async () => ({
      liveNegotiationResponse: PAYLOAD_SENTINEL,
      systemPromptInjection: 'PREMIUM_PROMPT_SENTINEL',
      contextBlock: 'PREMIUM_CONTEXT_SENTINEL',
    }),
  });
  const captured = [];
  helper.setNegotiationCoachingHandler(payload => captured.push(payload));

  installActiveMode('looking-for-work');
  await drainStream(helper.streamChat('compensation question'));

  assert.equal(
    captured.length,
    1,
    'intercept body must run in looking-for-work; coaching handler proves it',
  );
});
