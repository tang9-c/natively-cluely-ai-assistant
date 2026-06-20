import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const distPath = path.resolve(__dirname, '../../../dist-electron/electron/LLMHelper.js');
const { LLMHelper } = require(distPath);

function createLLMHelper({ persona = '', customNotes = '' } = {}) {
  const helper = new LLMHelper();
  helper.setPersonaPrompt(persona);
  helper.setCustomNotes(customNotes);
  return helper;
}

function collectStream(stream) {
  const chunks = [];
  return new Promise((resolve, reject) => {
    (async () => {
      try {
        for await (const chunk of stream) {
          chunks.push(chunk);
        }
        resolve(chunks);
      } catch (e) {
        reject(e);
      }
    })();
  });
}

test('buildProfileContext combines persona and customNotes with profile_history wrappers', () => {
  const helper = createLLMHelper({
    persona: 'You are a concise coach.',
    customNotes: 'I prefer short answers.',
  });

  const context = helper.buildProfileContext();

  assert.match(context, /USER-PROVIDED PERSONA CONTEXT/);
  assert.match(context, /You are a concise coach\./);
  assert.match(context, /\<user_context\>/);
  assert.match(context, /I prefer short answers\./);
});

test('buildProfileContext returns empty string when no persona or notes', () => {
  const helper = createLLMHelper();
  assert.equal(helper.buildProfileContext(), '');
});

test('_streamChatInner includes profile context in OpenAI user message', async () => {
  const helper = createLLMHelper({
    persona: 'Be formal.',
    customNotes: 'Use Chinese.',
  });

  let capturedUserMessage = null;
  helper.streamWithOpenai = async function*(userMessage) {
    capturedUserMessage = userMessage;
    yield 'ok';
  };
  helper.currentModelId = 'gpt-4o';
  helper.openaiClient = {};

  const stream = helper._streamChatInner(
    'What should I say?',
    undefined,
    'INTERVIEWER: Hi',
    undefined,
    true, // ignoreKnowledgeMode
    true, // skipModeInjection
  );
  await collectStream(stream);

  assert.ok(capturedUserMessage, 'OpenAI user message should be captured');
  assert.match(capturedUserMessage, /CONTEXT:/);
  assert.match(capturedUserMessage, /Be formal\./);
  assert.match(capturedUserMessage, /Use Chinese\./);
});

test('_streamChatInner includes profile context for Ollama', async () => {
  const helper = createLLMHelper({
    persona: 'Be friendly.',
  });

  let capturedUserContent = null;
  helper.streamWithOllama = async function*(message, context) {
    capturedUserContent = context ? `CONTEXT:\n${context}\n\nUSER:\n${message}` : message;
    yield 'ok';
  };
  helper.useOllama = true;

  const stream = helper._streamChatInner(
    'What should I say?',
    undefined,
    'INTERVIEWER: Hi',
    undefined,
    true,
    true,
  );
  await collectStream(stream);

  assert.ok(capturedUserContent, 'Ollama user content should be captured');
  assert.match(capturedUserContent, /Be friendly\./);
});

test('profile context is omitted when profile_history scope is denied', async () => {
  const helper = createLLMHelper({
    persona: 'Be formal.',
    customNotes: 'I prefer short answers.',
  });

  // Deny profile_history for all providers.
  helper.getProviderScopePolicy = () => ({
    profile_history: false,
  });

  let capturedUserMessage = null;
  helper.streamWithOpenai = async function*(userMessage) {
    capturedUserMessage = userMessage;
    yield 'ok';
  };
  helper.currentModelId = 'gpt-4o';
  helper.openaiClient = {};

  const stream = helper._streamChatInner(
    'What should I say?',
    undefined,
    'INTERVIEWER: Hi',
    undefined,
    true,
    true,
  );
  await collectStream(stream);

  assert.ok(capturedUserMessage, 'user message should be captured');
  assert.doesNotMatch(capturedUserMessage, /Be formal\./);
  assert.doesNotMatch(capturedUserMessage, /I prefer short answers\./);
});

test('chatWithGemini includes profile context in user message', async () => {
  const helper = createLLMHelper({
    persona: 'Be friendly.',
    customNotes: 'Keep it brief.',
  });

  let capturedUserContent = null;
  helper.generateWithOpenai = async function(userMessage) {
    capturedUserContent = userMessage;
    return 'ok';
  };
  helper.currentModelId = 'gpt-4o';
  helper.openaiClient = {};

  await helper.chatWithGemini('Hello', undefined, 'INTERVIEWER: Hi');

  assert.ok(capturedUserContent, 'Gemini user content should be captured');
  assert.match(capturedUserContent, /Be friendly\./);
  assert.match(capturedUserContent, /Keep it brief\./);
});
