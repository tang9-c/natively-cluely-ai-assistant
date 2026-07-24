import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const distRag = path.resolve('dist-electron/electron/rag');
const { RAGManager } = await import(
  pathToFileURL(path.join(distRag, 'RAGManager.js')).href
);
const { RAGRetriever } = await import(
  pathToFileURL(path.join(distRag, 'RAGRetriever.js')).href
);
const { fingerprintTranscript } = await import(
  pathToFileURL(path.join(distRag, 'MeetingTranscriptFingerprint.js')).href
);

function createDatabase() {
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

    INSERT INTO meetings (id, title, summary_json, rag_index_state)
    VALUES
      ('meeting-a', '预算会议 A', '{}', 'complete'),
      ('meeting-b', '预算会议 B', '{}', 'complete');

    INSERT INTO transcripts (meeting_id, speaker, content, timestamp_ms)
    VALUES
      ('meeting-a', '客户 A', '预算 为 700 万', 1000),
      ('meeting-b', '客户 B', '预算 为 300 万', 1000);
  `);
  return db;
}

function scoredChunk(id, meetingId, speaker, text) {
  return {
    id,
    meetingId,
    chunkIndex: 0,
    speaker,
    startMs: 1000,
    endMs: 1000,
    text,
    tokenCount: Math.ceil(text.length / 4),
    similarity: 0.9,
    lexicalScore: 0.9,
  };
}

function createManager() {
  const db = createDatabase();
  const meetingARows = db.prepare(`
    SELECT id, speaker, timestamp_ms AS timestampMs, content
    FROM transcripts
    WHERE meeting_id = 'meeting-a'
  `).all();
  const meetingAHash = fingerprintTranscript(meetingARows);
  db.prepare(`
    UPDATE meetings SET rag_transcript_hash = ? WHERE id = 'meeting-a'
  `).run(meetingAHash);

  const meetingAChunk = scoredChunk(1, 'meeting-a', '客户 A', '预算 为 700 万');
  const meetingBChunk = scoredChunk(2, 'meeting-b', '客户 B', '预算 为 300 万');
  const vectorStore = {
    getMeetingChunkState(meetingId) {
      if (meetingId === 'meeting-a') {
        return {
          chunkCount: 1,
          transcriptHash: meetingAHash,
          indexState: 'complete',
        };
      }
      return { chunkCount: 0, transcriptHash: null, indexState: 'missing' };
    },
    getChunksForMeeting(meetingId) {
      return meetingId === 'meeting-a' ? [meetingAChunk] : [];
    },
    async searchLexical(query, options) {
      assert.equal(options.meetingId, 'meeting-a');
      if (query.includes('天心')) return [];
      return [meetingAChunk, meetingBChunk];
    },
    async searchSimilar() {
      throw new Error('semantic search must not run without embeddings');
    },
  };
  const embeddingPipeline = {
    isReady() {
      return false;
    },
    getActiveSpaceKey() {
      return undefined;
    },
  };
  const retriever = new RAGRetriever(vectorStore, embeddingPipeline);
  const capturedPrompts = [];
  const llmHelper = {
    async *streamChatWithGemini(prompt) {
      capturedPrompts.push(prompt);
      yield '预算为 700 万';
    },
  };
  const manager = Object.create(RAGManager.prototype);
  manager.db = db;
  manager.vectorStore = vectorStore;
  manager.embeddingPipeline = embeddingPipeline;
  manager.retriever = retriever;
  manager.llmHelper = llmHelper;
  manager.ensureMeetingIndexInFlight = new Map();
  manager.uploadedMaterialContext = '上传材料声称预算为 300 万';
  manager.personaPrompt = '用户画像声称预算为 300 万';

  return { db, manager, capturedPrompts };
}

test('strict meeting search sends only meeting A evidence to the LLM without embeddings', async () => {
  const { db, manager, capturedPrompts } = createManager();
  const prepared = await manager.prepareMeetingQuery('meeting-a', '项目预算是多少');

  assert.equal(prepared.status, 'ready');
  let answer = '';
  for await (const chunk of manager.streamMeetingAnswer(prepared)) {
    answer += chunk;
  }

  assert.equal(answer, '预算为 700 万');
  assert.equal(capturedPrompts.length, 1);
  assert.match(capturedPrompts[0], /700 万/);
  assert.doesNotMatch(capturedPrompts[0], /300 万/);
  assert.doesNotMatch(capturedPrompts[0], /上传材料|用户画像/);
  db.close();
});

test('strict meeting search does not invoke the LLM when current-meeting evidence is absent', async () => {
  const { db, manager, capturedPrompts } = createManager();

  const prepared = await manager.prepareMeetingQuery('meeting-a', '天心');

  assert.deepEqual(prepared, {
    status: 'no_match',
    message: '本次会议中没有找到与“天心”相关的内容。',
  });
  assert.equal(capturedPrompts.length, 0);
  db.close();
});

test('meeting prompt explicitly forbids model memory and unsupported facts', async () => {
  const { db, manager, capturedPrompts } = createManager();
  const prepared = await manager.prepareMeetingQuery('meeting-a', '项目预算是多少');
  for await (const _chunk of manager.streamMeetingAnswer(prepared)) {
    // Consume the stream so the prompt is captured.
  }

  assert.match(capturedPrompts[0], /始终使用简体中文/);
  assert.match(capturedPrompts[0], /只能依据.*本次会议证据/);
  assert.match(capturedPrompts[0], /不得使用模型记忆/);
  assert.match(capturedPrompts[0], /不得补充证据中不存在的事实/);
  assert.doesNotMatch(capturedPrompts[0], /RAG|Embedding|chunks/);
  db.close();
});
