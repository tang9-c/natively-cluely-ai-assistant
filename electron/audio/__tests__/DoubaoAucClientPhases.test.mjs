import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const clientPath = path.resolve(root, 'dist-electron/electron/audio/doubaoAucClient.js');

async function loadClient() {
  return import(`${pathToFileURL(clientPath).href}?phases=${Date.now()}`);
}

function createOptions(overrides = {}) {
  return {
    submitEndpoint: 'https://example.test/submit',
    queryEndpoint: 'https://example.test/query',
    authHeader: { Authorization: 'Bearer secret-key' },
    audioBuffer: Buffer.from('private-audio'),
    filename: 'private.wav',
    contentType: 'audio/wav',
    formFields: { model: 'bigmodel' },
    extractTranscript: data => data?.result?.text || '',
    pollIntervalMs: 0,
    ...overrides,
  };
}

test('emits ordered, sanitized phase events for a successful multipart transcription', async () => {
  const { transcribeNewApiDoubaoAucMultipartFile } = await loadClient();
  const events = [];
  let queryCount = 0;

  const result = await transcribeNewApiDoubaoAucMultipartFile(createOptions({
    onPhase: event => events.push(event),
    post: async url => {
      if (url.endsWith('/submit')) {
        return { data: { task_id: 'private-task-id' }, headers: {} };
      }
      queryCount += 1;
      if (queryCount === 1) {
        return { data: { status_code: '20000001' }, headers: {} };
      }
      return {
        data: { status_code: '20000000', result: { text: 'private transcript' } },
        headers: {},
      };
    },
  }));

  assert.equal(result, 'private transcript');
  assert.deepEqual(events.map(event => event.phase), [
    'submit_started',
    'submit_completed',
    'poll_started',
    'poll_completed',
    'poll_started',
    'poll_completed',
    'task_completed',
    'result_parsed',
  ]);
  assert.deepEqual(events.filter(event => event.phase === 'poll_started').map(event => event.attempt), [1, 2]);
  assert.deepEqual(events.filter(event => event.phase === 'poll_completed').map(event => event.taskStatus), ['20000001', '20000000']);

  const serialized = JSON.stringify(events);
  assert.doesNotMatch(serialized, /secret-key|private-audio|private\.wav|private-task-id|private transcript/);
  for (const event of events) {
    assert.deepEqual(
      Object.keys(event).sort(),
      Object.keys(event).filter(key => ['phase', 'atMs', 'attempt', 'taskStatus', 'durationMs'].includes(key)).sort(),
    );
  }
});

test('observer failures do not affect the transcription result', async () => {
  const { transcribeNewApiDoubaoAucMultipartFile } = await loadClient();
  const result = await transcribeNewApiDoubaoAucMultipartFile(createOptions({
    onPhase: () => {
      throw new Error('observer failure');
    },
    post: async url => url.endsWith('/submit')
      ? { data: { task_id: 'task-1' }, headers: {} }
      : { data: { status_code: '20000000', result: { text: 'done' } }, headers: {} },
  }));

  assert.equal(result, 'done');
});

test('submit failures preserve the original error and stop after submit_started', async () => {
  const { transcribeNewApiDoubaoAucMultipartFile } = await loadClient();
  const expected = new Error('private submit response');
  const events = [];

  await assert.rejects(
    transcribeNewApiDoubaoAucMultipartFile(createOptions({
      onPhase: event => events.push(event),
      post: async () => { throw expected; },
    })),
    error => error === expected,
  );
  assert.deepEqual(events.map(event => event.phase), ['submit_started']);
});

test('poll failures preserve the original error and stop after poll_started', async () => {
  const { transcribeNewApiDoubaoAucMultipartFile } = await loadClient();
  const expected = new Error('private poll response');
  const events = [];

  await assert.rejects(
    transcribeNewApiDoubaoAucMultipartFile(createOptions({
      onPhase: event => events.push(event),
      post: async url => {
        if (url.endsWith('/submit')) return { data: { task_id: 'task-1' }, headers: {} };
        throw expected;
      },
    })),
    error => error === expected,
  );
  assert.deepEqual(events.map(event => event.phase), [
    'submit_started',
    'submit_completed',
    'poll_started',
  ]);
});
