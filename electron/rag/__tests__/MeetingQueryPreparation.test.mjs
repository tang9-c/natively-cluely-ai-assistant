import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distRag = path.resolve('dist-electron/electron/rag');
const { RAGManager } = await import(
  pathToFileURL(path.join(distRag, 'RAGManager.js')).href
);
const { fingerprintTranscript } = await import(
  pathToFileURL(path.join(distRag, 'MeetingTranscriptFingerprint.js')).href
);

function createDatabase({ includeMeeting = true, transcript = true } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT,
      summary_json TEXT,
      rag_transcript_hash TEXT,
      rag_index_state TEXT NOT NULL DEFAULT 'missing'
    );
    CREATE TABLE transcripts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      meeting_id TEXT,
      speaker TEXT,
      content TEXT,
      timestamp_ms INTEGER
    );
  `);
  if (includeMeeting) {
    db.prepare(`
      INSERT INTO meetings (id, title, summary_json)
      VALUES (?, ?, ?)
    `).run(
      'meeting-a',
      '采购讨论',
      JSON.stringify({
        detailedSummary: {
          overview: '采购系统集成讨论',
          keyPoints: ['飞书作为统一入口'],
          actionItems: ['张三跟进接口'],
          decisions: ['确定不重复建设'],
        },
      }),
    );
  }
  if (includeMeeting && transcript) {
    db.prepare(`
      INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
      VALUES (?, ?, ?, ?)
    `).run('meeting-a', '客户', '预算 为 700 万 并且 需要 项目 管理', 1000);
  }
  return db;
}

function storedChunk(text = '预算 为 700 万') {
  return {
    id: 1,
    meetingId: 'meeting-a',
    chunkIndex: 0,
    speaker: '客户',
    startMs: 1000,
    endMs: 1000,
    text,
    tokenCount: Math.ceil(text.length / 4),
    similarity: 0.9,
  };
}

function sourceRows(db) {
  return db.prepare(`
    SELECT
      id,
      speaker,
      timestamp_ms AS timestampMs,
      content
    FROM transcripts
    WHERE meeting_id = ?
    ORDER BY timestamp_ms ASC, id ASC
  `).all('meeting-a');
}

function createHarness({
  db = createDatabase(),
  initialState = {
    chunkCount: 0,
    transcriptHash: null,
    indexState: 'missing',
  },
  retrievedChunks = [storedChunk()],
  llmAvailable = true,
  replaceError,
} = {}) {
  let state = { ...initialState };
  let timeline = initialState.chunkCount > 0 ? [storedChunk()] : [];
  const calls = {
    replace: 0,
    mark: [],
    queue: 0,
    retrieve: [],
  };
  const vectorStore = {
    getMeetingChunkState() {
      return { ...state };
    },
    markMeetingIndexState(_meetingId, nextState) {
      calls.mark.push(nextState);
      state.indexState = nextState;
    },
    replaceMeetingChunksAtomically(_meetingId, chunks, transcriptHash) {
      calls.replace += 1;
      if (replaceError) throw replaceError;
      timeline = chunks.map((item, index) => ({ ...item, id: index + 10, similarity: 0.8 }));
      state = {
        chunkCount: chunks.length,
        transcriptHash,
        indexState: 'complete',
      };
    },
    getChunksForMeeting() {
      return timeline;
    },
  };
  const embeddingPipeline = {
    isReady() {
      return true;
    },
    async queueMeeting() {
      calls.queue += 1;
    },
  };
  const retriever = {
    detectIntent() {
      return 'open_question';
    },
    async retrieve(query, options) {
      calls.retrieve.push({ query, options });
      return {
        chunks: retrievedChunks,
        formattedContext: '',
        totalTokens: 0,
        meetingIds: ['meeting-a'],
        intent: options.intent,
        retrievalQuery: query,
        citations: [],
      };
    },
  };
  const manager = Object.create(RAGManager.prototype);
  manager.db = db;
  manager.vectorStore = vectorStore;
  manager.embeddingPipeline = embeddingPipeline;
  manager.retriever = retriever;
  manager.llmHelper = llmAvailable
    ? { streamChatWithGemini: async function* () { yield '回答'; } }
    : null;
  manager.ensureMeetingIndexInFlight = new Map();

  return { manager, calls, getState: () => state };
}

test('preparation distinguishes a missing meeting and an empty transcript', async () => {
  const missing = createHarness({
    db: createDatabase({ includeMeeting: false }),
  });
  const empty = createHarness({
    db: createDatabase({ transcript: false }),
  });

  assert.deepEqual(
    await missing.manager.prepareMeetingQuery('meeting-a', '预算'),
    { status: 'meeting_not_found', message: '无法找到本次会议。' },
  );
  assert.deepEqual(
    await empty.manager.prepareMeetingQuery('meeting-a', '预算'),
    {
      status: 'transcript_unavailable',
      message: '本次会议没有可供搜索的转录内容。',
    },
  );
});

test('preparation rebuilds missing, incomplete, failed, and hash-mismatched indexes', async () => {
  for (const initialState of [
    { chunkCount: 0, transcriptHash: null, indexState: 'missing' },
    { chunkCount: 1, transcriptHash: null, indexState: 'building' },
    { chunkCount: 1, transcriptHash: null, indexState: 'failed' },
    { chunkCount: 1, transcriptHash: 'stale-hash', indexState: 'complete' },
  ]) {
    const harness = createHarness({ initialState });
    const result = await harness.manager.prepareMeetingQuery('meeting-a', '预算');
    assert.equal(result.status, 'ready');
    assert.equal(harness.calls.replace, 1);
    assert.equal(harness.getState().indexState, 'complete');
  }
});

test('preparation reuses a complete index whose transcript fingerprint matches', async () => {
  const db = createDatabase();
  const transcriptHash = fingerprintTranscript(sourceRows(db));
  const harness = createHarness({
    db,
    initialState: {
      chunkCount: 1,
      transcriptHash,
      indexState: 'complete',
    },
  });

  const result = await harness.manager.prepareMeetingQuery('meeting-a', '预算');

  assert.equal(result.status, 'ready');
  assert.equal(harness.calls.replace, 0);
});

test('concurrent preparation rebuilds the same meeting at most once', async () => {
  const harness = createHarness();

  const [first, second] = await Promise.all([
    harness.manager.prepareMeetingQuery('meeting-a', '预算'),
    harness.manager.prepareMeetingQuery('meeting-a', '决定'),
  ]);

  assert.equal(first.status, 'ready');
  assert.equal(second.status, 'ready');
  assert.equal(harness.calls.replace, 1);
});

test('rebuild failure marks the meeting failed and returns a fixed query error', async () => {
  const harness = createHarness({
    replaceError: new Error('database details must not escape'),
  });

  const result = await harness.manager.prepareMeetingQuery('meeting-a', '预算');

  assert.deepEqual(result, {
    status: 'query_failed',
    message: '本次会议搜索暂时不可用，请稍后重试。',
  });
  assert.equal(harness.getState().indexState, 'failed');
});

test('preparation returns no_match without requiring an LLM when evidence is empty', async () => {
  const harness = createHarness({
    retrievedChunks: [],
    llmAvailable: false,
  });

  const result = await harness.manager.prepareMeetingQuery('meeting-a', '天心');

  assert.deepEqual(result, {
    status: 'no_match',
    message: '本次会议中没有找到与“天心”相关的内容。',
  });
});

test('preparation reports LLM availability only after current-meeting evidence exists', async () => {
  const harness = createHarness({ llmAvailable: false });

  const result = await harness.manager.prepareMeetingQuery('meeting-a', '预算');

  assert.deepEqual(result, {
    status: 'llm_unavailable',
    message: '会议内容已找到，但当前无法生成回答，请稍后重试。',
  });
});

test('ready preparation contains only current-meeting formatted evidence', async () => {
  const harness = createHarness({
    retrievedChunks: [
      storedChunk('预算 为 700 万'),
      { ...storedChunk('预算 为 300 万'), id: 2, meetingId: 'meeting-b' },
    ],
  });

  const result = await harness.manager.prepareMeetingQuery('meeting-a', '预算');

  assert.equal(result.status, 'ready');
  assert.equal(result.meetingId, 'meeting-a');
  assert.match(result.formattedContext, /700 万/);
  assert.doesNotMatch(result.formattedContext, /300 万/);
});
