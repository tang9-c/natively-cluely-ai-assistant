// electron/llm/__tests__/ModeAwareIntent.test.mjs
//
// Coverage tests for the mode-aware intent classifier.
//
// Two test groups:
//   1. Tier 1 regex coverage: every mode should hit the regex fast-path on
//      at least 80% of the canonical utterances in that mode. This is the
//      "main keywords" half of the "main keywords + fallback SLM" strategy.
//   2. Tier 2 SLM-friendly edge cases: cases where the regex *shouldn't*
//      match (paraphrase, synonym, mixed language), and the mode label set
//      is the only fallback. These are kept here as fixtures so future
//      regressions of the per-mode label sets show up immediately.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const modulePath = path.resolve(
  __dirname, '../../../dist-electron/electron/llm/IntentClassifier.js',
);

function loadModule() {
  return cjsRequire(modulePath);
}

const { detectIntentByPattern } = loadModule();

// ---------------------------------------------------------------------------
// Tier 1 — Regex fast-path coverage per mode
// ---------------------------------------------------------------------------

/**
 * Run the regex fast-path over a list of (utterance, expectedIntent) pairs
 * and return the hit rate. Used to assert ≥80% coverage per mode.
 */
function coverageRate(mode, samples) {
  let hits = 0;
  const misses = [];
  for (const { utterance, expected } of samples) {
    const r = detectIntentByPattern(utterance, mode);
    if (r && r.intent === expected) {
      hits += 1;
    } else {
      misses.push({ utterance, expected, got: r?.intent ?? null });
    }
  }
  return { rate: hits / samples.length, hits, total: samples.length, misses };
}

describe('Tier 1 regex coverage: sales mode ≥80%', () => {
  const samples = [
    // English — objection
    { utterance: "This is too expensive for us right now.", expected: 'handle_objection' },
    { utterance: "Can you do better on the price?", expected: 'handle_objection' },
    { utterance: "We're already using Gong, why switch?", expected: 'handle_objection' },
    { utterance: "It's out of our budget this quarter.", expected: 'handle_objection' },
    { utterance: "Any discount if we sign annual?", expected: 'handle_objection' },
    // Chinese — objection
    { utterance: '这个价格太高了', expected: 'handle_objection' },
    { utterance: '能不能便宜点', expected: 'handle_objection' },
    { utterance: '预算不够', expected: 'handle_objection' },
    { utterance: '我们已经在用 Gong 了', expected: 'handle_objection' },
    { utterance: '有折扣吗', expected: 'handle_objection' },
    // English — buying signal
    { utterance: "We're ready to move forward.", expected: 'seize_signal' },
    { utterance: "Can you send over the contract?", expected: 'seize_signal' },
    { utterance: "What are the next steps?", expected: 'seize_signal' },
    { utterance: "Let's finalize the deal.", expected: 'seize_signal' },
    // Chinese — buying signal
    { utterance: '我们准备签合同了', expected: 'seize_signal' },
    { utterance: '下一步怎么走', expected: 'seize_signal' },
    // English — discovery probe
    { utterance: "What's the biggest challenge you're trying to solve?", expected: 'discovery_probe' },
    { utterance: "What does your current workflow look like?", expected: 'discovery_probe' },
    { utterance: "What's the ROI on this for a team our size?", expected: 'discovery_probe' },
    // Chinese — discovery probe
    { utterance: '你们现在遇到什么挑战', expected: 'discovery_probe' },
    { utterance: '现在的流程是怎样的', expected: 'discovery_probe' },
  ];

  test('sales regex hits ≥80% of canonical utterances', () => {
    const { rate, total, misses } = coverageRate('sales', samples);
    assert.ok(
      rate >= 0.8,
      `sales mode hit rate ${(rate * 100).toFixed(1)}% < 80% (${misses.length}/${total} misses): ` +
      JSON.stringify(misses, null, 2),
    );
  });
});

describe('Tier 1 regex coverage: team-meet mode ≥80%', () => {
  const samples = [
    // English — action item
    { utterance: "I'll send the PR by Friday.", expected: 'capture_action' },
    { utterance: "Action item: I'll own the migration.", expected: 'capture_action' },
    { utterance: "I'll handle the rollout, deadline is next Wednesday.", expected: 'capture_action' },
    { utterance: "I can have the proposal ready by EOD.", expected: 'capture_action' },
    { utterance: "Assigned to Alice for the search rewrite.", expected: 'capture_action' },
    // Chinese — action item
    { utterance: '我周五前发 PR', expected: 'capture_action' },
    { utterance: '这个行动项我来负责', expected: 'capture_action' },
    { utterance: '我来跟进,下周三前完成', expected: 'capture_action' },
    { utterance: '今天内上线', expected: 'capture_action' },
    { utterance: '让 Bob 去做', expected: 'capture_action' },
    // English — decision
    { utterance: "We've decided to go with Postgres.", expected: 'capture_decision' },
    { utterance: "Let's go with the second option.", expected: 'capture_decision' },
    { utterance: "Final decision: ship the new auth flow.", expected: 'capture_decision' },
    { utterance: "Approved by the security team.", expected: 'capture_decision' },
    // Chinese — decision
    { utterance: '我们决定用 Postgres', expected: 'capture_decision' },
    { utterance: '就选这个方案', expected: 'capture_decision' },
    { utterance: '批准了', expected: 'capture_decision' },
    // English — risk/blocker
    { utterance: "We're blocked on the design review.", expected: 'capture_risk' },
    { utterance: "This is at risk of slipping the deadline.", expected: 'capture_risk' },
    { utterance: "Depends on the migration finishing first.", expected: 'capture_risk' },
    { utterance: "We're stuck on the auth refactor.", expected: 'capture_risk' },
    // Chinese — risk/blocker
    { utterance: '被卡在 review 上了', expected: 'capture_risk' },
    { utterance: '这个有延期风险', expected: 'capture_risk' },
    { utterance: '依赖迁移先完成', expected: 'capture_risk' },
    // English — status update
    { utterance: "Where are we on the migration?", expected: 'status_update' },
    { utterance: "What's the status of the rollout?", expected: 'status_update' },
    { utterance: "Any progress on the search fix?", expected: 'status_update' },
    // Chinese — status update
    { utterance: '进度怎么样', expected: 'status_update' },
    { utterance: '谁负责这块', expected: 'status_update' },
    { utterance: '什么时候能上线', expected: 'status_update' },
  ];

  test('team-meet regex hits ≥80% of canonical utterances', () => {
    const { rate, total, misses } = coverageRate('team-meet', samples);
    assert.ok(
      rate >= 0.8,
      `team-meet mode hit rate ${(rate * 100).toFixed(1)}% < 80% (${misses.length}/${total} misses): ` +
      JSON.stringify(misses, null, 2),
    );
  });
});

describe('Tier 1 regex coverage: lecture mode ≥80%', () => {
  const samples = [
    // English — concept
    { utterance: "This is called the second law of thermodynamics.", expected: 'explain_concept' },
    { utterance: "The concept of entropy means disorder.", expected: 'explain_concept' },
    { utterance: "By definition, a prime has exactly two divisors.", expected: 'explain_concept' },
    { utterance: "The principle of locality in physics.", expected: 'explain_concept' },
    { utterance: "Let me introduce the theorem of Bayes.", expected: 'explain_concept' },
    // Chinese — concept
    { utterance: '这个叫做牛顿第二定律', expected: 'explain_concept' },
    { utterance: '熵的概念', expected: 'explain_concept' },
    { utterance: '所谓的协方差', expected: 'explain_concept' },
    { utterance: '这个定理的证明', expected: 'explain_concept' },
    { utterance: '引入一个新的概念', expected: 'explain_concept' },
    // English — formula
    { utterance: "The formula is E equals m c squared.", expected: 'render_formula' },
    { utterance: "The equation for kinetic energy.", expected: 'render_formula' },
    { utterance: "The theorem of Pythagoras says a squared plus b squared equals c squared.", expected: 'render_formula' },
    { utterance: "We can derive this by integration.", expected: 'render_formula' },
    { utterance: "Sum of i from 1 to n equals n times n plus 1 over 2.", expected: 'render_formula' },
    // Chinese — formula
    { utterance: '公式是 F 等于 m 乘以 a', expected: 'render_formula' },
    { utterance: '这个方程的解', expected: 'render_formula' },
    { utterance: '高斯定理', expected: 'render_formula' },
    { utterance: '对 x 求导', expected: 'render_formula' },
    { utterance: '矩阵乘法', expected: 'render_formula' },
    // English — class question
    { utterance: "Anyone know the answer?", expected: 'answer_class_question' },
    { utterance: "Who can tell me what Big O means?", expected: 'answer_class_question' },
    { utterance: "Raise your hand if you know.", expected: 'answer_class_question' },
    { utterance: "Class, what is the time complexity here?", expected: 'answer_class_question' },
    // Chinese — class question
    { utterance: '谁知道答案', expected: 'answer_class_question' },
    { utterance: '谁能回答一下', expected: 'answer_class_question' },
    { utterance: '请回答', expected: 'answer_class_question' },
    { utterance: '怎么算', expected: 'answer_class_question' },
  ];

  test('lecture regex hits ≥80% of canonical utterances', () => {
    const { rate, total, misses } = coverageRate('lecture', samples);
    assert.ok(
      rate >= 0.8,
      `lecture mode hit rate ${(rate * 100).toFixed(1)}% < 80% (${misses.length}/${total} misses): ` +
      JSON.stringify(misses, null, 2),
    );
  });
});

describe('Tier 1 regex coverage: recruiting mode (extras only — falls through to interview)', () => {
  const samples = [
    // English — request_example (recruiting-specific)
    { utterance: "Can you give me a concrete example?", expected: 'request_example' },
    { utterance: "Walk me through a specific time you handled this.", expected: 'request_example' },
    { utterance: "Do you have an example of that?", expected: 'request_example' },
    // Chinese — request_example
    { utterance: '举一个具体的例子', expected: 'request_example' },
    { utterance: '讲一个具体的例子', expected: 'request_example' },
    { utterance: '你能不能举个例子', expected: 'request_example' },
    // Falls through to interview regex (behavioral)
    { utterance: "Tell me about a time you led a team.", expected: 'behavioral' },
    { utterance: '讲讲你以前怎么处理的', expected: 'behavioral' },
  ];

  test('recruiting regex routes request_example + falls through to behavioral', () => {
    let requestExampleHits = 0;
    let behavioralHits = 0;
    const misses = [];
    for (const { utterance, expected } of samples) {
      const r = detectIntentByPattern(utterance, 'recruiting');
      if (r && r.intent === expected) {
        if (expected === 'request_example') requestExampleHits += 1;
        if (expected === 'behavioral') behavioralHits += 1;
      } else {
        misses.push({ utterance, expected, got: r?.intent ?? null });
      }
    }
    assert.ok(
      requestExampleHits >= 5,
      `recruiting request_example hits ${requestExampleHits}/6 < 5`,
    );
    assert.ok(
      behavioralHits >= 2,
      `recruiting behavioral fallthrough hits ${behavioralHits}/2 < 2 (full miss list: ${JSON.stringify(misses)})`,
    );
  });

  test('recruiting dispatch prefers recruiting-specific request_example before interview fallback', () => {
    const requestExample = detectIntentByPattern('你能不能举一个具体的例子?', 'recruiting');
    const behavioralFallback = detectIntentByPattern('Tell me about a time you led a team.', 'recruiting');

    assert.equal(requestExample?.intent, 'request_example');
    assert.equal(behavioralFallback?.intent, 'behavioral');
  });
});

// ---------------------------------------------------------------------------
// Tier 2 — Edge cases that should be ROUTED via SLM (regex misses by design)
// ---------------------------------------------------------------------------
//
// These utterances are paraphrases / synonyms / mixed-language / ambiguous
// inputs. By design they do NOT match Tier 1 regex (no clear keyword). The
// test asserts that the regex returns null, so the SLM is the only fallback.
// Keeping these as fixtures also documents the "we accept SLM handles this"
// contract — if a future change accidentally makes regex match them, that's
// fine, but the test will notice.

describe('Tier 2 edge cases: regex intentionally misses so SLM can take over', () => {
  // No "no, but..." in regex vocabulary — pure paraphrase relies on SLM
  test('paraphrased sales objection does not match regex (SLM territory)', () => {
    const r = detectIntentByPattern(
      "I'm a bit concerned about the cost-benefit ratio here.",
      'sales',
    );
    assert.equal(r, null);
  });

  // Synonym for "blocker" that regex doesn't cover
  test('paraphrased team-meet blocker does not match regex (SLM territory)', () => {
    const r = detectIntentByPattern(
      "We kinda hit a wall with the migration.",
      'team-meet',
    );
    assert.equal(r, null);
  });

  // Synonym for "formula" — "equals" without LaTeX cues
  test('paraphrased formula does not match lecture regex (SLM territory)', () => {
    const r = detectIntentByPattern(
      "So when you square the radius and multiply by pi you get the area.",
      'lecture',
    );
    assert.equal(r, null);
  });

  // Mixed language with no clear keyword from either side
  test('mixed-language sales input does not match regex (SLM territory)', () => {
    const r = detectIntentByPattern(
      "Today's demo 我来 lead 一下",
      'sales',
    );
    assert.equal(r, null);
  });

  // Recruiter's "evaluate" intent is intentionally SLM-only (no keywords)
  test('evaluative recruiter question does not match regex (SLM territory)', () => {
    const r = detectIntentByPattern(
      "How well did this person actually own the result?",
      'recruiting',
    );
    assert.equal(r, null);
  });
});

// ---------------------------------------------------------------------------
// Mode isolation — regex for one mode should NOT fire for another mode
// ---------------------------------------------------------------------------
//
// This is the "no cross-contamination" test. A `handle_objection` regex
// triggered in `team-meet` mode would pollute the action-item capture flow.
// Such regressions would silently corrupt the planner pipeline.

describe('Mode isolation: regex tables do not cross-fire', () => {
  test('sales price objection does not fire in team-meet mode', () => {
    const r = detectIntentByPattern("This is too expensive.", 'team-meet');
    assert.equal(r, null);
  });

  test('team-meet action item does not fire in sales mode', () => {
    const r = detectIntentByPattern("I'll send the PR by Friday.", 'sales');
    assert.equal(r, null);
  });

  test('lecture concept introduction does not fire in general mode', () => {
    const r = detectIntentByPattern("This is called entropy.", 'general');
    assert.equal(r, null);
  });

  test('interview behavioral does not fire in sales mode', () => {
    // "Tell me about a time" is interview-style — sales should not match
    // it as a discovery probe. Falls through to SLM.
    const r = detectIntentByPattern(
      "Tell me about a time you exceeded your quota.",
      'sales',
    );
    assert.equal(r, null);
  });
});

// ---------------------------------------------------------------------------
// getAnswerShapeForMode — confirm mode-specific shapes override general
// ---------------------------------------------------------------------------

describe('getAnswerShapeForMode returns mode-specific shapes', () => {
  const { getAnswerShapeForMode } = loadModule();

  test('team-meet capture_action shape contains 📋', () => {
    const shape = getAnswerShapeForMode('team-meet', 'capture_action');
    assert.match(shape, /📋/);
    assert.match(shape, /Owner/i);
  });

  test('sales handle_objection shape contains "I hear you" or "makes sense"', () => {
    const shape = getAnswerShapeForMode('sales', 'handle_objection');
    assert.ok(
      /I hear you|makes sense/i.test(shape),
      `expected objection shape, got: ${shape}`,
    );
  });

  test('lecture render_formula shape contains "LaTeX"', () => {
    const shape = getAnswerShapeForMode('lecture', 'render_formula');
    assert.match(shape, /LaTeX/i);
  });

  test('recruiting evaluate_answer shape contains "Ask them:"', () => {
    const shape = getAnswerShapeForMode('recruiting', 'evaluate_answer');
    assert.match(shape, /Ask them:/i);
  });

  test('unknown mode falls back to general table', () => {
    const behaviorShape = getAnswerShapeForMode('general', 'behavioral');
    const unknownShape = getAnswerShapeForMode('nonexistent-mode', 'behavioral');
    assert.equal(behaviorShape, unknownShape);
  });

  test('null mode parameter falls back to general', () => {
    const shape = getAnswerShapeForMode(null, 'coding');
    assert.equal(shape, getAnswerShapeForMode('general', 'coding'));
  });
});

// ---------------------------------------------------------------------------
// isModeInterviewFamily helper
// ---------------------------------------------------------------------------

describe('isModeInterviewFamily correctly classifies modes', () => {
  const { isModeInterviewFamily } = loadModule();

  test('interview-family modes return true', () => {
    assert.equal(isModeInterviewFamily('general'), true);
    assert.equal(isModeInterviewFamily('looking-for-work'), true);
    assert.equal(isModeInterviewFamily('technical-interview'), true);
  });

  test('recruiting is excluded from interview family (gets specialized dispatcher)', () => {
    assert.equal(isModeInterviewFamily('recruiting'), false);
  });

  test('non-interview modes return false', () => {
    assert.equal(isModeInterviewFamily('sales'), false);
    assert.equal(isModeInterviewFamily('team-meet'), false);
    assert.equal(isModeInterviewFamily('lecture'), false);
  });

  test('null/undefined defaults to general (true)', () => {
    assert.equal(isModeInterviewFamily(null), true);
    assert.equal(isModeInterviewFamily(undefined), true);
  });

  test('unknown mode returns false (treated as non-interview, forces explicit lookup)', () => {
    assert.equal(isModeInterviewFamily('nonexistent'), false);
  });
});
