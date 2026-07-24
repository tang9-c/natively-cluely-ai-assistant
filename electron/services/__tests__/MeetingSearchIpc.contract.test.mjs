import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ipcSource = fs.readFileSync('electron/ipcHandlers.ts', 'utf8');
const meetingHandlerStart = ipcSource.indexOf("'rag:query-meeting'");
const meetingHandlerEnd = ipcSource.indexOf('// Query live meeting with JIT RAG', meetingHandlerStart);
const meetingHandler = ipcSource.slice(meetingHandlerStart, meetingHandlerEnd);

async function loadRegistry() {
  return import(pathToFileURL(path.resolve(
    'dist-electron/electron/rag/MeetingSearchRequestRegistry.js',
  )).href);
}

async function loadFlow() {
  return import(pathToFileURL(path.resolve(
    'dist-electron/electron/rag/MeetingSearchFlow.js',
  )).href);
}

test('meeting IPC has no generic chat, global search, or material fallback', () => {
  assert.ok(meetingHandlerStart > 0);
  assert.doesNotMatch(meetingHandler, /fallback/);
  assert.doesNotMatch(meetingHandler, /queryGlobal/);
  assert.doesNotMatch(meetingHandler, /resolveUploadedMaterialChatContext/);
  assert.doesNotMatch(meetingHandler, /gemini-chat-stream/);
  assert.match(meetingHandler, /getDeniedDataScopes/);
  assert.match(meetingHandler, /executeMeetingSearch/);
  assert.ok(
    meetingHandler.indexOf('getDeniedDataScopes')
      < meetingHandler.indexOf('executeMeetingSearch'),
  );
});

test('request registry supersedes only the same sender and meeting', async () => {
  const { MeetingSearchRequestRegistry } = await loadRegistry();
  const registry = new MeetingSearchRequestRegistry();

  const first = registry.start(10, 'meeting-a', 'request-1');
  const otherSender = registry.start(11, 'meeting-a', 'request-2');
  const replacement = registry.start(10, 'meeting-a', 'request-3');

  assert.equal(first.signal.aborted, true);
  assert.equal(otherSender.signal.aborted, false);
  assert.equal(replacement.signal.aborted, false);
  assert.equal(registry.isCurrent(10, 'meeting-a', 'request-3'), true);
  assert.equal(registry.isCurrent(11, 'meeting-a', 'request-2'), true);
});

test('stale completion cannot delete a newer request and cancel requires requestId', async () => {
  const { MeetingSearchRequestRegistry } = await loadRegistry();
  const registry = new MeetingSearchRequestRegistry();

  registry.start(10, 'meeting-a', 'request-1');
  const latest = registry.start(10, 'meeting-a', 'request-2');

  registry.finish(10, 'meeting-a', 'request-1');
  assert.equal(registry.isCurrent(10, 'meeting-a', 'request-2'), true);
  assert.equal(registry.cancel(10, 'meeting-a', 'request-1'), false);
  assert.equal(latest.signal.aborted, false);
  assert.equal(registry.cancel(10, 'meeting-a', 'request-2'), true);
  assert.equal(latest.signal.aborted, true);
});

test('meeting flow emits request-scoped chunks and completion', async () => {
  const { executeMeetingSearch } = await loadFlow();
  const events = [];
  const manager = {
    async prepareMeetingQuery() {
      return {
        status: 'ready',
        meetingId: 'meeting-a',
        query: '预算',
        formattedContext: '预算为 700 万',
        intent: 'open_question',
      };
    },
    async *streamMeetingAnswer() {
      yield '预算';
      yield '为 700 万';
    },
  };

  const result = await executeMeetingSearch({
    ragManager: manager,
    request: {
      meetingId: 'meeting-a',
      query: '预算',
      requestId: 'request-1',
    },
    signal: new AbortController().signal,
    send(channel, payload) {
      events.push({ channel, payload });
    },
  });

  assert.deepEqual(result, { status: 'success' });
  assert.deepEqual(events, [
    {
      channel: 'rag:stream-chunk',
      payload: {
        requestId: 'request-1',
        meetingId: 'meeting-a',
        global: false,
        chunk: '预算',
      },
    },
    {
      channel: 'rag:stream-chunk',
      payload: {
        requestId: 'request-1',
        meetingId: 'meeting-a',
        global: false,
        chunk: '为 700 万',
      },
    },
    {
      channel: 'rag:stream-complete',
      payload: {
        requestId: 'request-1',
        meetingId: 'meeting-a',
        global: false,
      },
    },
  ]);
});

test('cancelled meeting flow sends no complete or error event', async () => {
  const { executeMeetingSearch } = await loadFlow();
  const events = [];
  const controller = new AbortController();
  const manager = {
    async prepareMeetingQuery() {
      return {
        status: 'ready',
        meetingId: 'meeting-a',
        query: '预算',
        formattedContext: '预算为 700 万',
        intent: 'open_question',
      };
    },
    async *streamMeetingAnswer() {
      controller.abort();
      yield '不应显示';
    },
  };

  const result = await executeMeetingSearch({
    ragManager: manager,
    request: {
      meetingId: 'meeting-a',
      query: '预算',
      requestId: 'request-1',
    },
    signal: controller.signal,
    send(channel, payload) {
      events.push({ channel, payload });
    },
  });

  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual(events, []);
});

test('stream failure emits a fixed Chinese request-scoped error and discards technical details', async () => {
  const { executeMeetingSearch } = await loadFlow();
  const events = [];
  const manager = {
    async prepareMeetingQuery() {
      return {
        status: 'ready',
        meetingId: 'meeting-a',
        query: '预算',
        formattedContext: '预算为 700 万',
        intent: 'open_question',
      };
    },
    async *streamMeetingAnswer() {
      yield '部分回答';
      throw new Error('provider secret and endpoint');
    },
  };

  const result = await executeMeetingSearch({
    ragManager: manager,
    request: {
      meetingId: 'meeting-a',
      query: '预算',
      requestId: 'request-1',
    },
    signal: new AbortController().signal,
    send(channel, payload) {
      events.push({ channel, payload });
    },
  });

  assert.deepEqual(result, {
    status: 'query_failed',
    message: '本次会议搜索暂时不可用，请稍后重试。',
  });
  assert.deepEqual(events.at(-1), {
    channel: 'rag:stream-error',
    payload: {
      requestId: 'request-1',
      meetingId: 'meeting-a',
      global: false,
      status: 'query_failed',
      message: '本次会议搜索暂时不可用，请稍后重试。',
    },
  });
  assert.doesNotMatch(JSON.stringify(events), /provider secret|endpoint/);
});
