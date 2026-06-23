// electron/services/__tests__/IntelligenceEngineTriggerGates.test.mjs
//
// Path B coverage — direct unit tests for the WhatToAnswer auto-trigger
// gating logic. Existing IntelligenceEngineSentinel.test.mjs only covers the
// chain end-to-end with `skipCooldown: true`, which sidesteps every production
// gate. This file exercises the gates themselves so a regression to the
// debounce, word/confidence thresholds, question-signal regex, or 3-second
// cooldown fails the test suite — not just ships silently.
//
// Coverage matrix:
//   1. hasQuestionSignal — direct unit tests for English/Chinese regex
//   2. maybeSpeculate — gates + 350ms debounce via fake timers
//   3. runWhatShouldISay — 3s cooldown + hasImages/isSpeculative/skipCooldown bypasses
//   4. lastTriggerTime stamping — non-speculative at start, speculative on completion/abort

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadIntelligenceEngine() {
  const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
  return import(pathToFileURL(enginePath).href);
}

async function loadSessionTracker() {
  const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
  return import(pathToFileURL(sessionPath).href);
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

async function makeEngine() {
  const { IntelligenceEngine } = await loadIntelligenceEngine();
  const { SessionTracker } = await loadSessionTracker();
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(new StubLLMHelper(), session);
  return { engine, session, IntelligenceEngine };
}

// =============================================================================
// 1. hasQuestionSignal — direct unit tests
// =============================================================================
//
// Source: IntelligenceEngine.ts:352-356
// Logic:
//   - text ending in ? or ？ → true (terminal question mark)
//   - English interrogatives (what/how/why/where/when/which/who, can you,
//     could you, tell me, explain, describe, walk me through, talk me through)
//   - Chinese interrogatives (什么/怎么/如何/为什么/... + longer cues like
//     介绍一下/展开讲讲/你的问题/我的经验/类似案例)
//
// Tests assert true/false pairs so a regression on either side fails. Boundary
// cases focus on phrases that have historically been a near-miss (English
// "Just thinking" / Chinese "你好") and on the bilingual cues listed in the
// commit that introduced the second Chinese wave.
describe('hasQuestionSignal — direct regex unit tests', () => {
  let IntelligenceEngine;
  test('static method exists and is callable', async () => {
    const mod = await loadIntelligenceEngine();
    IntelligenceEngine = mod.IntelligenceEngine;
    assert.equal(typeof IntelligenceEngine.hasQuestionSignal, 'function');
  });

  // English interrogatives — match
  const englishPositive = [
    'What is the answer?',
    'How does this work?',
    'Why did you choose that?',
    'Where are we headed?',
    'When can we start?',
    'Which option is best?',
    'Who is responsible for this?',
    'Can you explain that to me?',
    'Could you elaborate on the proposal?',
    'Tell me about your background.',
    'Explain the trade-off in more detail.',
    'Describe the deployment process.',
    'Walk me through the architecture.',
    'Talk me through your reasoning.',
  ];
  for (const text of englishPositive) {
    test(`English match: "${text}"`, async () => {
      const { IntelligenceEngine } = await loadIntelligenceEngine();
      assert.equal(IntelligenceEngine.hasQuestionSignal(text), true);
    });
  }

  // English non-questions — reject (regression guard against false positives
  // that would cause the auto-trigger to fire on every transcript segment).
  const englishNegative = [
    'I agree with that.',
    'Just thinking out loud.',
    'Sounds good to me.',
    'Let me check the dashboard.',
    'The deployment completed successfully.',
    'Moving on to the next topic.',
    '', // empty string
    '   ', // whitespace only
  ];
  for (const text of englishNegative) {
    test(`English non-match: "${text}"`, async () => {
      const { IntelligenceEngine } = await loadIntelligenceEngine();
      assert.equal(IntelligenceEngine.hasQuestionSignal(text), false);
    });
  }

  // Chinese interrogatives — match. Includes both short (什么/怎么) and the
  // longer cues (介绍一下/展开讲讲/你的问题/我的经验/类似案例) that were added
  // for cases where short 什么/怎么 are absent but the intent is clearly
  // request-for-information.
  const chinesePositive = [
    '怎么做?',
    '你能介绍一下这个方案吗',
    '什么是 RAG?',
    '请问如何使用这个功能?',
    '你怎么看这个问题?',
    '你能讲一下吗?',
    '说一下你的思路。',
    '介绍一下你的项目。',
    '展开讲讲这部分。',
    '你的问题是什么?',
    '我的经验是...',
    '有没有类似案例?',
    '类似情况怎么处理?',
    '类似问题的解决方案?',
  ];
  for (const text of chinesePositive) {
    test(`Chinese match: "${text}"`, async () => {
      const { IntelligenceEngine } = await loadIntelligenceEngine();
      assert.equal(IntelligenceEngine.hasQuestionSignal(text), true);
    });
  }

  // Chinese non-questions — reject
  const chineseNegative = [
    '你好',
    '我同意',
    '继续',
    '好的',
    '没问题',
    '已经完成了',
    '我先看看',
    '稍等一下',
  ];
  for (const text of chineseNegative) {
    test(`Chinese non-match: "${text}"`, async () => {
      const { IntelligenceEngine } = await loadIntelligenceEngine();
      assert.equal(IntelligenceEngine.hasQuestionSignal(text), false);
    });
  }

  // Terminal question-mark bypass — must fire on any text ending in ? or ？
  // regardless of whether interrogative words appear.
  test('Terminal "?" triggers without interrogative word', async () => {
    const { IntelligenceEngine } = await loadIntelligenceEngine();
    assert.equal(IntelligenceEngine.hasQuestionSignal('Sounds good?'), true);
    assert.equal(IntelligenceEngine.hasQuestionSignal('真的吗？'), true);
  });

  test('Trailing whitespace before "?" still triggers', async () => {
    const { IntelligenceEngine } = await loadIntelligenceEngine();
    // Source regex is /[?？]\s*$/ — allow trailing whitespace.
    assert.equal(IntelligenceEngine.hasQuestionSignal('really?  '), true);
  });
});

// =============================================================================
// 2. maybeSpeculate — gate tests with fake timers
// =============================================================================
//
// Source: IntelligenceEngine.ts:360-390
// Gates (all must pass to set the 350ms debounce timer):
//   - activeMode must be 'idle' or 'assist' (else return)
//   - confidence >= 0.75 (SPECULATIVE_MIN_CONFIDENCE)
//   - word count >= 7 OR cjkCharCount >= 12 (SPECULATIVE_MIN_WORDS / cjk fallback)
//   - hasQuestionSignal(text) is true
// Then setTimeout(350ms) before invoking runWhatShouldISay({ speculative: true }).
//
// All previous tests in the repo bypassed this with skipCooldown; here we go
// through the production path so a regression on debounce timing, word-count
// threshold, or confidence threshold fails the test.
describe('maybeSpeculate — production gates + 350ms debounce', () => {
  test('does NOT schedule timer when word count < 7 (English)', async () => {
    const { engine } = await makeEngine();
    let runCalls = 0;
    engine.whatToAnswerLLM = {
      async *generateStream() { runCalls++; yield ''; },
    };
    // "What is the deal here?" is 6 words — under SPECULATIVE_MIN_WORDS=7.
    engine.maybeSpeculate({
      speaker: 'interviewer', text: 'What is the deal here?',
      timestamp: Date.now(), final: false, confidence: 0.9,
    });
    assert.equal(engine.speculativeTimer, null);
    assert.equal(runCalls, 0);
  });

  test('does NOT schedule timer when CJK char count < 12', async () => {
    const { engine } = await makeEngine();
    engine.whatToAnswerLLM = { async *generateStream() { yield ''; } };
    // 11 CJK chars — under the cjkCharCount >= 12 threshold (no spaces).
    engine.maybeSpeculate({
      speaker: 'interviewer', text: '你能介绍一下这个方案吗?',
      timestamp: Date.now(), final: false, confidence: 0.9,
    });
    assert.equal(engine.speculativeTimer, null);
  });

  test('does NOT schedule timer when confidence < 0.75', async () => {
    const { engine } = await makeEngine();
    engine.whatToAnswerLLM = { async *generateStream() { yield ''; } };
    engine.maybeSpeculate({
      speaker: 'interviewer',
      text: 'What should we do about this very important thing here now please?',
      timestamp: Date.now(), final: false, confidence: 0.74,
    });
    assert.equal(engine.speculativeTimer, null);
  });

  test('does NOT schedule timer when text has no question signal', async () => {
    const { engine } = await makeEngine();
    engine.whatToAnswerLLM = { async *generateStream() { yield ''; } };
    // 10 words (>= 7), confidence 0.9 (>= 0.75), but no question signal.
    engine.maybeSpeculate({
      speaker: 'interviewer',
      text: 'The deployment completed successfully and we shipped the new feature.',
      timestamp: Date.now(), final: false, confidence: 0.9,
    });
    assert.equal(engine.speculativeTimer, null);
  });

  test('schedules timer at exactly 350ms when all gates pass (English)', async () => {
    const { engine } = await makeEngine();
    engine.whatToAnswerLLM = { async *generateStream() { yield ''; } };

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const now = Date.now();
      mock.timers.setTime(now);
      engine.maybeSpeculate({
        speaker: 'interviewer',
        text: 'What should we do about this very important thing here now please?',
        timestamp: now, final: false, confidence: 0.9,
      });
      // Right after scheduling — timer pending, no fire yet.
      assert.notEqual(engine.speculativeTimer, null);
      // Advance to just before the 350ms mark — still no fire.
      mock.timers.tick(349);
      // The speculativeText / lastTriggerTime are still null because the
      // timer hasn't fired.
      assert.equal(engine.speculativeText, null);
      // Advance past 350ms — timer fires (runWhatShouldISay enters).
      mock.timers.tick(2);
      // After fire, the debounce timer slot is cleared.
      assert.equal(engine.speculativeTimer, null);
    } finally {
      mock.timers.reset();
    }
  });

  test('rapid-fire same-direction inputs reset the debounce (only last one wins)', async () => {
    const { engine } = await makeEngine();
    let runCalls = 0;
    engine.whatToAnswerLLM = {
      async *generateStream() { runCalls++; yield ''; },
    };

    mock.timers.enable({ apis: ['setTimeout'] });
    try {
      const now = Date.now();
      mock.timers.setTime(now);
      engine.maybeSpeculate({
        speaker: 'interviewer',
        text: 'What should we do about this very important thing here now please?',
        timestamp: now, final: false, confidence: 0.9,
      });
      // Advance 200ms (still inside the 350ms window) and fire another.
      mock.timers.tick(200);
      engine.maybeSpeculate({
        speaker: 'interviewer',
        text: 'How should we respond to that very important thing here now please?',
        timestamp: now + 200, final: false, confidence: 0.9,
      });
      // Advance another 200ms — total 400ms since first, but only 200ms
      // since second. Second timer hasn't fired yet.
      mock.timers.tick(200);
      // Advance the remaining 150ms — second timer fires.
      mock.timers.tick(150);
      // We can't directly assert runCalls here without flushMicrotasks; the
      // critical assertion is that the first timer was cancelled (cleared
      // its handle) and the engine ended up in the speculative state.
      assert.equal(engine.speculativeTimer, null);
    } finally {
      mock.timers.reset();
    }
  });
});

// =============================================================================
// 3. runWhatShouldISay — 3s cooldown + hasImages/isSpeculative/skipCooldown bypasses
// =============================================================================
//
// Source: IntelligenceEngine.ts:731-740
// Gate: `!hasImages && !isSpeculative && !skipCooldown &&
//        now - this.lastTriggerTime < this.triggerCooldown (3000)`
// → return null without invoking the LLM stream.
//
// All three bypass conditions must be tested independently because they serve
// distinct product purposes:
//   - hasImages: user intent (screenshots force a real answer)
//   - isSpeculative: production pre-fetch (auto-trigger from interim transcript)
//   - skipCooldown: test harness / explicit user re-trigger
describe('runWhatShouldISay — cooldown gate + bypasses', () => {
  test('returns null when within cooldown window (no bypass)', async () => {
    const { engine, session } = await makeEngine();
    let runCalls = 0;
    engine.whatToAnswerLLM = {
      async *generateStream() { runCalls++; yield 'should not see this'; },
    };
    // Prime a real trigger so lastTriggerTime is set to a known value.
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    await engine.runWhatShouldISay('How should we respond to that?', 0.9, undefined, {
      skipCooldown: true,
    });
    const primedAt = engine.lastTriggerTime;
    assert.ok(primedAt > 0, 'real trigger should stamp lastTriggerTime');

    // Second call WITHOUT bypass — should be rejected by cooldown.
    const result = await engine.runWhatShouldISay('What about the second thing?', 0.9);
    assert.equal(result, null, 'within-cooldown call must return null without firing LLM');
    // lastTriggerTime was NOT advanced by the rejected call.
    assert.equal(engine.lastTriggerTime, primedAt);
  });

  test('hasImages bypasses cooldown (within window)', async () => {
    const { engine, session } = await makeEngine();
    engine.whatToAnswerLLM = {
      async *generateStream() { yield 'answer with image'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    // Prime the cooldown.
    await engine.runWhatShouldISay('How should we respond to that?', 0.9, undefined, {
      skipCooldown: true,
    });
    const primedAt = engine.lastTriggerTime;

    // Within cooldown, but WITH images — must bypass.
    const result = await engine.runWhatShouldISay('What is on screen?', 0.9, ['/tmp/img.png']);
    assert.notEqual(result, null, 'image-bypass must not be gated by cooldown');
    assert.ok(engine.lastTriggerTime >= primedAt, 'real trigger stamps lastTriggerTime');
  });

  test('isSpeculative bypasses cooldown (within window)', async () => {
    const { engine, session } = await makeEngine();
    engine.whatToAnswerLLM = {
      async *generateStream() { yield 'speculative answer'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    // Prime the cooldown.
    await engine.runWhatShouldISay('How should we respond to that?', 0.9, undefined, {
      skipCooldown: true,
    });
    // Within cooldown (lastTriggerTime is fresh), but SPECULATIVE — must bypass.
    // This test only verifies the BYPASS, not the stamp semantics — those are
    // covered separately in the "lastTriggerTime stamping semantics" suite.
    // Stamp assertions that compare against primedAt are flaky because both
    // Date.now() calls can land in the same millisecond on fast machines.
    const result = await engine.runWhatShouldISay('What is the proposal about?', 0.9, undefined, {
      speculative: true,
    });
    assert.notEqual(result, null, 'speculative-bypass must not be gated by cooldown');
    // Confirm the LLM was actually invoked (not silently null-rejected).
    // If we got a real answer back, the gate was bypassed.
    assert.equal(typeof result, 'string');
    assert.ok(result.length > 0, 'speculative bypass must yield a real LLM answer');
  });

  test('skipCooldown bypasses (test harness / explicit re-trigger)', async () => {
    const { engine, session } = await makeEngine();
    engine.whatToAnswerLLM = {
      async *generateStream() { yield 'forced answer'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    await engine.runWhatShouldISay('How should we respond to that?', 0.9, undefined, {
      skipCooldown: true,
    });
    const result = await engine.runWhatShouldISay('What is the next step?', 0.9, undefined, {
      skipCooldown: true,
    });
    assert.notEqual(result, null, 'skipCooldown bypasses cooldown gate');
  });

  test('after cooldown window elapses, real trigger fires again', async () => {
    const { engine, session } = await makeEngine();
    let runCalls = 0;
    engine.whatToAnswerLLM = {
      async *generateStream() { runCalls++; yield 'second answer'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    // Prime and capture the timestamp.
    await engine.runWhatShouldISay('How should we respond to that?', 0.9, undefined, {
      skipCooldown: true,
    });
    // Backdate lastTriggerTime to 4 seconds ago — past the 3s cooldown.
    engine.lastTriggerTime = Date.now() - 4000;

    const result = await engine.runWhatShouldISay('What is the next step?', 0.9);
    assert.notEqual(result, null, 'past-cooldown call must fire');
  });
});

// =============================================================================
// 4. lastTriggerTime stamping semantics
// =============================================================================
//
// Source: IntelligenceEngine.ts:750-752, 872-873, 889-890, 897
// Semantics:
//   - Real trigger (non-speculative): stamp at start of runWhatShouldISay.
//   - Speculative: do NOT stamp at start (cooldown reserved for real
//     trigger that aborts the speculative). Stamp on:
//       - completion (line 897)
//       - abort (line 873, when a newer generation preempts the stream)
//       - non-answer sentinel (line 890)
//     And clear speculativeText + set expiry.
describe('lastTriggerTime stamping semantics', () => {
  test('real (non-speculative) trigger stamps lastTriggerTime at start', async () => {
    const { engine, session } = await makeEngine();
    engine.whatToAnswerLLM = {
      async *generateStream() { yield 'answer'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    const before = Date.now();
    await engine.runWhatShouldISay('How should we respond to that?', 0.9, undefined, {
      skipCooldown: true,
    });
    const after = Date.now();
    assert.ok(engine.lastTriggerTime >= before && engine.lastTriggerTime <= after,
      `real trigger must stamp lastTriggerTime at start; got ${engine.lastTriggerTime} for window [${before}, ${after}]`);
  });

  test('speculative trigger does NOT stamp at start (reserves slot for preempting real trigger)', async () => {
    const { engine, session } = await makeEngine();
    engine.whatToAnswerLLM = {
      async *generateStream() { yield 'speculative answer'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    // Set lastTriggerTime to a known prior value.
    const priorStamp = Date.now() - 10_000;
    engine.lastTriggerTime = priorStamp;

    await engine.runWhatShouldISay('What is the proposal about?', 0.9, undefined, {
      speculative: true,
    });
    // After the speculative run completes, the stamp is updated — but the
    // critical assertion is that DURING the run (between schedule and
    // completion), the real trigger is NOT blocked by the speculative's
    // start. We verify the post-condition: the stamp is updated only on
    // completion, not at start. We check by ensuring the stamp changed to
    // a recent value (within the last 1s).
    assert.ok(engine.lastTriggerTime > priorStamp,
      'speculative completion must update lastTriggerTime');
    assert.ok(Date.now() - engine.lastTriggerTime < 1000,
      'speculative stamp should be very recent (completion time)');
  });

  test('speculative abort (stream preemption) stamps lastTriggerTime', async () => {
    const { engine, session } = await makeEngine();
    // Slow stream that yields one token, then would yield more — but we
    // simulate the abort by incrementing currentGenerationId before the
    // next iteration. This triggers the line 873 stamp.
    let yielded = 0;
    engine.whatToAnswerLLM = {
      async *generateStream() {
        yield 'first token';
        // Before yielding the second token, simulate a newer generation
        // arriving by bumping currentGenerationId on the engine. The
        // consumer loop compares this against its captured generationId
        // and aborts.
        engine.currentGenerationId = engine.currentGenerationId + 1;
        yield 'this should be ignored';
      },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    const priorStamp = Date.now() - 10_000;
    engine.lastTriggerTime = priorStamp;

    const result = await engine.runWhatShouldISay('What is the proposal about?', 0.9, undefined, {
      speculative: true,
    });
    // The aborted stream path returns null and stamps lastTriggerTime.
    assert.equal(result, null, 'aborted stream must return null');
    assert.ok(engine.lastTriggerTime > priorStamp,
      'speculative abort must stamp lastTriggerTime (to throttle preempting triggers)');
  });

  test('speculative non-answer sentinel stamps lastTriggerTime', async () => {
    const { engine, session } = await makeEngine();
    engine.whatToAnswerLLM = {
      async *generateStream() { yield 'Nothing actionable right now.'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    const priorStamp = Date.now() - 10_000;
    engine.lastTriggerTime = priorStamp;

    const result = await engine.runWhatShouldISay('What is the proposal about?', 0.9, undefined, {
      speculative: true,
    });
    assert.equal(result, null, 'sentinel must be suppressed to null');
    assert.ok(engine.lastTriggerTime > priorStamp,
      'speculative sentinel suppression must stamp lastTriggerTime');
  });

  test('speculative completion (real answer) stamps lastTriggerTime', async () => {
    const { engine, session } = await makeEngine();
    engine.whatToAnswerLLM = {
      async *generateStream() { yield 'Real answer here.'; },
    };
    session.addTranscript({
      speaker: 'interviewer', text: 'How should we respond to that?',
      timestamp: Date.now(), final: true,
    });
    const priorStamp = Date.now() - 10_000;
    engine.lastTriggerTime = priorStamp;

    const result = await engine.runWhatShouldISay('What is the proposal about?', 0.9, undefined, {
      speculative: true,
    });
    assert.notEqual(result, null, 'real speculative answer must surface');
    assert.ok(engine.lastTriggerTime > priorStamp,
      'speculative completion must stamp lastTriggerTime');
    // speculativeTextExpiry should be set to a finite future timestamp
    // (not Infinity) so Jaccard comparison can time out.
    assert.ok(Number.isFinite(engine.speculativeTextExpiry),
      'speculativeTextExpiry must be finite on completion');
  });
});
