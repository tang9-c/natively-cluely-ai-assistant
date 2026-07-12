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

async function makeEngineWithAnswer(chunks) {
  const { IntelligenceEngine } = await import(pathToFileURL(enginePath).href);
  const { SessionTracker } = require(sessionPath);
  const session = new SessionTracker();
  const engine = new IntelligenceEngine(makeHelper(), session);

  engine.whatToAnswerLLM = {
    async *generateStream() {
      for (const chunk of chunks) yield chunk;
    },
  };

  return { engine, session };
}

test('runWhatShouldISay suppresses nothing-actionable sentinel output', async () => {
  const { engine, session } = await makeEngineWithAnswer(['Nothing ', 'actionable right now.']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('anything actionable?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, null);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('Nothing actionable')), false);
});

test('runWhatShouldISay suppresses nothing-to-capture sentinel output', async () => {
  const { engine, session } = await makeEngineWithAnswer([' Nothing to capture right now.\n']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('anything to capture?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, null);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text.includes('Nothing to capture')), false);
});

test('runWhatShouldISay suppresses normalized sentinel variants', async () => {
  const { engine, session } = await makeEngineWithAnswer(['  NOTHING ACTIONABLE RIGHT NOW!!!  ']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('anything actionable?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, null);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
});

test('runWhatShouldISay suppresses provider fallback repeat prompt from usage history', async () => {
  const fallback = 'Could you repeat that? I want to make sure I address your question properly.';
  const { engine, session } = await makeEngineWithAnswer([fallback]);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, null);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text === fallback), false);
});

test('runWhatShouldISay does not suppress near-match real answers', async () => {
  const nearMatch = 'Nothing actionable right now, but I can ask a clarifying question.';
  const { engine, session } = await makeEngineWithAnswer([nearMatch]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay('anything actionable?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, nearMatch);
  assert.deepEqual(finals, [nearMatch]);
  assert.equal(session.getFullUsage()[0].answer, nearMatch);
});

test('runWhatShouldISay suppresses speculative sentinel output', async () => {
  const { engine, session } = await makeEngineWithAnswer(['Nothing to capture right now.']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('speculative trigger', 0.9, undefined, { speculative: true, skipCooldown: true });

  assert.equal(answer, null);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
});

test('runWhatShouldISay hides speculative real answers from renderer and history', async () => {
  const realAnswer = 'I would explain the tradeoff clearly and ask which constraint matters most.';
  const { engine, session } = await makeEngineWithAnswer(['I would explain ', 'the tradeoff clearly ', 'and ask which constraint matters most.']);
  const events = [];
  engine.on('suggested_answer_token', token => events.push(['token', token]));
  engine.on('suggested_answer', answer => events.push(['final', answer]));

  const answer = await engine.runWhatShouldISay('speculative trigger', 0.9, undefined, { speculative: true, skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.deepEqual(events, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text === realAnswer), false);
});

test('runWhatShouldISay hides speculative fallback answers from renderer and history', async () => {
  const fallbackAnswer = 'I would start with the invariant and then walk through edge cases.';
  const { engine, session } = await makeEngineWithAnswer([]);
  engine.whatToAnswerLLM = null;
  engine.answerLLM = {
    async generate() {
      return fallbackAnswer;
    },
  };
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay('speculative fallback', 0.9, undefined, { speculative: true, skipCooldown: true });

  assert.equal(answer, fallbackAnswer);
  assert.deepEqual(finals, []);
  assert.deepEqual(session.getFullUsage(), []);
  assert.equal(session.getFullTranscript().some(segment => segment.text === fallbackAnswer), false);
});

test('runWhatShouldISay still emits and stores real answers', async () => {
  const realAnswer = 'I would explain the tradeoff clearly and ask which constraint matters most.';
  const { engine, session } = await makeEngineWithAnswer(['I would explain ', 'the tradeoff clearly ', 'and ask which constraint matters most.']);
  const tokens = [];
  const finals = [];
  engine.on('suggested_answer_token', token => tokens.push(token));
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay('how should I answer?', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.equal(tokens.join(''), realAnswer);
  assert.deepEqual(finals, [realAnswer]);
  assert.equal(session.getFullUsage().length, 1);
  assert.equal(session.getFullUsage()[0].answer, realAnswer);
  assert.equal(session.getFullTranscript().some(segment => segment.text === realAnswer), true);
});

test('runWhatShouldISay emits provider chunks before completion with a stable request id', async () => {
  const { engine } = await makeEngineWithAnswer([]);
  let releaseSecondChunk;
  const waitForRelease = new Promise(resolve => { releaseSecondChunk = resolve; });
  engine.whatToAnswerLLM = {
    async *generateStream() {
      yield 'Start with the conclusion. ';
      await waitForRelease;
      yield 'Then explain the tradeoff.';
    },
  };
  const tokens = [];
  const finals = [];
  engine.on('suggested_answer_token', (token, _question, _confidence, requestId) => {
    tokens.push({ token, requestId });
  });
  engine.on('suggested_answer', (answer, _question, _confidence, requestId) => {
    finals.push({ answer, requestId });
  });

  const pending = engine.runWhatShouldISay('how should I answer?', 0.9, undefined, {
    skipCooldown: true,
    requestId: 'req-stream-1',
  });
  await new Promise(resolve => setImmediate(resolve));

  assert.deepEqual(tokens, [{ token: 'Start with the conclusion. ', requestId: 'req-stream-1' }]);
  assert.deepEqual(finals, []);

  releaseSecondChunk();
  const answer = await pending;
  assert.equal(answer, 'Start with the conclusion. Then explain the tradeoff.');
  assert.equal(tokens.map(item => item.token).join(''), answer);
  assert.deepEqual(finals, [{ answer, requestId: 'req-stream-1' }]);
});

test('runWhatShouldISay rejects an older request reserved before async preparation completes', async () => {
  const { engine, session } = await makeEngineWithAnswer(['stale answer']);
  let tokenCount = 0;
  engine.on('suggested_answer_token', () => tokenCount++);

  engine.reserveWhatShouldISayRequest('request-new');
  const answer = await engine.runWhatShouldISay('old question', 0.9, undefined, {
    skipCooldown: true,
    requestId: 'request-old',
  });

  assert.equal(answer, null);
  assert.equal(tokenCount, 0);
  assert.deepEqual(session.getFullUsage(), []);
});

test('runWhatShouldISay propagates QCLOUD failures without persisting a fallback answer', async () => {
  const { engine, session } = await makeEngineWithAnswer([]);
  engine.whatToAnswerLLM = {
    async *generateStream() {
      throw new Error('QCLOUD stream_interrupted: idle timeout');
    },
  };
  const errors = [];
  engine.on('error', (error, _mode, requestId) => errors.push({ message: error.message, requestId }));

  await assert.rejects(
    engine.runWhatShouldISay('question', 0.9, undefined, {
      skipCooldown: true,
      requestId: 'request-qcloud-error',
    }),
    /stream_interrupted/,
  );

  assert.deepEqual(session.getFullUsage(), []);
  assert.deepEqual(errors, [{
    message: 'QCLOUD stream_interrupted: idle timeout',
    requestId: 'request-qcloud-error',
  }]);
});

test('reserving a newer request aborts an active what-to-say stream without an error event', async () => {
  const { engine, session } = await makeEngineWithAnswer([]);
  let streamStarted;
  const started = new Promise((resolve) => { streamStarted = resolve; });
  engine.whatToAnswerLLM = {
    async *generateStream(...args) {
      const requestOptions = args[12];
      streamStarted();
      await new Promise((_, reject) => {
        requestOptions.abortSignal.addEventListener(
          'abort',
          () => reject(requestOptions.abortSignal.reason),
          { once: true },
        );
      });
    },
  };
  const errors = [];
  engine.on('error', (error) => errors.push(error.message));
  engine.reserveWhatShouldISayRequest('request-old');
  const pending = engine.runWhatShouldISay('old question', 0.9, undefined, {
    skipCooldown: true,
    requestId: 'request-old',
  });
  await started;

  engine.reserveWhatShouldISayRequest('request-new');

  assert.equal(await pending, null);
  assert.deepEqual(errors, []);
  assert.deepEqual(session.getFullUsage(), []);
});

test('runWhatShouldISay labels inferred Chinese usage questions in Chinese', async () => {
  const realAnswer = '我会先用一句话回答结论，然后补充一个具体例子。';
  const { engine, session } = await makeEngineWithAnswer([realAnswer]);
  const finals = [];
  engine.on('suggested_answer', (_answer, question) => finals.push(question));

  session.handleTranscript({
    speaker: 'interviewer',
    text: '你能不能说明一下这个方案的取舍，以及为什么这样设计？',
    timestamp: Date.now(),
    final: true,
    confidence: 0.95,
  });

  const answer = await engine.runWhatShouldISay(undefined, 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, realAnswer);
  assert.equal(session.getFullUsage()[0].question, '待回答内容');
  assert.deepEqual(finals, ['待回答内容']);
});

test('runWhatShouldISay normalizes pathological line-by-line chinese answers', async () => {
  const fragmented = '这是一个测试\n\n如果\n\n您\n\n有\n\n具体\n\n的\n\n问题\n\n或\n\n需要\n\n协助\n\n的\n\n事项\n\n，请\n\n告诉我';
  const normalized = '这是一个测试如果您有具体的问题或需要协助的事项，请告诉我';
  const { engine, session } = await makeEngineWithAnswer([fragmented]);
  const finals = [];
  engine.on('suggested_answer', answer => finals.push(answer));

  const answer = await engine.runWhatShouldISay('test', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, normalized);
  assert.deepEqual(finals, [normalized]);
  assert.equal(session.getFullUsage()[0].answer, normalized);
});

test('runWhatShouldISay preserves normal paragraph breaks', async () => {
  const paragraphAnswer = '先确认目标。\n\n然后给出两个可选方案。';
  const { engine, session } = await makeEngineWithAnswer([paragraphAnswer]);

  const answer = await engine.runWhatShouldISay('test', 0.9, undefined, { skipCooldown: true });

  assert.equal(answer, paragraphAnswer);
  assert.equal(session.getFullUsage()[0].answer, paragraphAnswer);
});
