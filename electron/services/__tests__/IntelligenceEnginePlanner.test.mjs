import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const enginePath = path.resolve(__dirname, '../../../dist-electron/electron/IntelligenceEngine.js');
const sessionPath = path.resolve(__dirname, '../../../dist-electron/electron/SessionTracker.js');
const require = createRequire(import.meta.url);

function makeHelper() {
  return {
    setNegotiationCoachingHandler() {},
  };
}

async function makeEngine() {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);
  return { engine, session };
}

test('handleSuggestionTrigger stays silent for low confidence without emitting or storing history', async () => {
  const { engine, session } = await makeEngine();
  let answerCalls = 0;
  engine.whatToAnswerLLM = {
    async *generateStream() {
      answerCalls++;
      yield 'should not emit';
    },
  };
  const events = [];
  engine.on('suggested_answer', answer => events.push(answer));
  engine.on('suggested_answer_token', token => events.push(token));

  await engine.handleSuggestionTrigger({
    context: 'quiet filler',
    lastQuestion: 'quiet filler',
    confidence: 0.2,
  });

  assert.equal(answerCalls, 0);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.speaker === 'assistant'), false);
});

test('handleSuggestionTrigger routes recap requests to recap executor', async () => {
  const { engine } = await makeEngine();
  let recapCalls = 0;
  let answerCalls = 0;
  engine.runRecap = async () => {
    recapCalls++;
    return 'recap result';
  };
  engine.whatToAnswerLLM = {
    async *generateStream() {
      answerCalls++;
      yield 'wrong path';
    },
  };

  await engine.handleSuggestionTrigger({
    context: 'Can you recap the key points so far?',
    lastQuestion: 'Can you recap the key points so far?',
    confidence: 0.9,
  });

  assert.equal(recapCalls, 1);
  assert.equal(answerCalls, 0);
});

test('handleSuggestionTrigger routes answerable questions to what-to-say executor', async () => {
  const { engine, session } = await makeEngine();
  session.handleTranscript({
    speaker: 'interviewer',
    text: 'How should you explain the implementation tradeoff?',
    timestamp: Date.now(),
    final: true,
    confidence: 0.95,
  });
  const answer = 'I would frame it around latency, maintainability, and rollout risk.';
  let answerCalls = 0;
  engine.whatToAnswerLLM = {
    async *generateStream() {
      answerCalls++;
      yield answer;
    },
  };
  const finals = [];
  engine.on('suggested_answer', value => finals.push(value));

  await engine.handleSuggestionTrigger({
    context: 'How should you explain the implementation tradeoff?',
    lastQuestion: 'How should you explain the implementation tradeoff?',
    confidence: 0.9,
  });

  assert.equal(answerCalls, 1);
  assert.deepEqual(finals, [answer]);
  assert.equal(session.getFullUsage()[0].answer, answer);
});

test('handleSuggestionTrigger routes incomplete technical restatements to clarify executor', async () => {
  const { engine } = await makeEngine();
  let clarifyCalls = 0;
  let answerCalls = 0;
  engine.runClarify = async () => {
    clarifyCalls++;
    return { ok: true, clarification: 'Could you clarify the exact input, output, and constraints?' };
  };
  engine.whatToAnswerLLM = {
    async *generateStream() {
      answerCalls++;
      yield 'wrong path';
    },
  };

  await engine.handleSuggestionTrigger({
    context: 'Sorry let me restate, given an array and the thing should return the output but constraints are unclear',
    lastQuestion: 'Sorry let me restate, given an array and the thing should return the output but constraints are unclear',
    confidence: 0.92,
  });

  assert.equal(clarifyCalls, 1);
  assert.equal(answerCalls, 0);
});

test('handleSuggestionTrigger still answers complete technical restatements', async () => {
  const { engine, session } = await makeEngine();
  const answer = 'I would solve it with a hash map that stores seen numbers and checks complements.';
  let clarifyCalls = 0;
  let answerCalls = 0;
  engine.runClarify = async () => {
    clarifyCalls++;
    return { ok: false, reason: 'no_llm' };
  };
  engine.whatToAnswerLLM = {
    async *generateStream() {
      answerCalls++;
      yield answer;
    },
  };

  await engine.handleSuggestionTrigger({
    context: 'Sorry let me restate, given an array of integers, return the indices of two numbers that add up to target.',
    lastQuestion: 'Sorry let me restate, given an array of integers, return the indices of two numbers that add up to target.',
    confidence: 0.92,
  });

  assert.equal(clarifyCalls, 0);
  assert.equal(answerCalls, 1);
  assert.equal(session.getFullUsage()[0].answer, answer);
});

test('runClarify returns { ok: false, reason: "no_llm" } when clarify LLM is not initialized', async () => {
  const { engine } = await makeEngine();
  // The constructor auto-runs initializeLLMs(), so explicitly null out
  // clarifyLLM to exercise the "no_llm" branch.
  engine.clarifyLLM = null;
  const result = await engine.runClarify();
  assert.deepEqual(result, { ok: false, reason: 'no_llm' });
});

test('runClarify returns { ok: false, reason: "aborted" } when a new generation supersedes it', async () => {
  const { engine } = await makeEngine();
  // Install a slow stream that yields one token at a time so we can race
  // a new generationId in before it finishes.
  engine.clarifyLLM = {
    async *generateStream() {
      yield 'partial';
      // Block on a microtask boundary so the test can bump currentGenerationId
      await new Promise(resolve => setImmediate(resolve));
      yield 'rest of stream';
    },
  };
  const first = engine.runClarify();
  // Bump generationId to force the in-flight stream to abort.
  // Access the private field via a cast — same engine instance.
  engine['currentGenerationId'] = 999;
  const result = await first;
  assert.deepEqual(result, { ok: false, reason: 'aborted' });
});

test('runClarify returns { ok: false, reason: "empty" } when the stream yields no tokens', async () => {
  const { engine } = await makeEngine();
  engine.clarifyLLM = {
    async *generateStream() {
      // yield nothing — simulates a swallowed provider error in ClarifyLLM
    },
  };
  const result = await engine.runClarify();
  assert.deepEqual(result, { ok: false, reason: 'empty' });
});

test('runClarify returns { ok: true, clarification } on a normal stream', async () => {
  const { engine } = await makeEngine();
  engine.clarifyLLM = {
    async *generateStream() {
      yield 'What ';
      yield 'are the constraints?';
    },
  };
  const result = await engine.runClarify();
  assert.deepEqual(result, { ok: true, clarification: 'What are the constraints?' });
});

test('runClarify returns { ok: false, reason: "error", detail } when the stream throws', async () => {
  const { engine } = await makeEngine();
  // Swallow the 'error' event — EventEmitter throws synchronously when
  // emit('error', ...) fires with no listener attached.
  engine.on('error', () => {});
  engine.clarifyLLM = {
    async *generateStream() {
      throw new Error('provider 401');
    },
  };
  const result = await engine.runClarify();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'error');
  assert.equal(result.detail, 'provider 401');
});
