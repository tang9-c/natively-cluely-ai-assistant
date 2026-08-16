import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const { EmbeddingPipeline } = require(
  path.join(root, 'dist-electron/electron/rag/EmbeddingPipeline.js'),
);

function pipelineWithOutstandingCount(count) {
  const pipeline = Object.create(EmbeddingPipeline.prototype);
  pipeline.fallbackMeetings = new Set(['meeting-fallback']);
  pipeline.db = {
    prepare(sql) {
      assert.match(sql, /status IN \('pending', 'processing'\)/);
      return {
        get(meetingId) {
          assert.equal(meetingId, 'meeting-fallback');
          return { count };
        },
      };
    },
  };
  return pipeline;
}

test('fallback meeting state is released when its queue is settled', () => {
  const pipeline = pipelineWithOutstandingCount(0);

  pipeline.releaseMeetingFallbackIfSettled('meeting-fallback');

  assert.equal(pipeline.fallbackMeetings.has('meeting-fallback'), false);
});

test('fallback meeting state remains while work is pending or processing', () => {
  const pipeline = pipelineWithOutstandingCount(1);

  pipeline.releaseMeetingFallbackIfSettled('meeting-fallback');

  assert.equal(pipeline.fallbackMeetings.has('meeting-fallback'), true);
});

test('successful queue completion checks whether fallback state can be released', () => {
  const source = fs.readFileSync(path.join(root, 'electron/rag/EmbeddingPipeline.ts'), 'utf8');
  const completedUpdate = source.indexOf("SET status = 'completed', processed_at = ?");
  const releaseCall = source.indexOf(
    'this.releaseMeetingFallbackIfSettled(pending.meeting_id)',
    completedUpdate,
  );

  assert.ok(completedUpdate >= 0, 'completed queue update should exist');
  assert.ok(releaseCall > completedUpdate, 'fallback release check should follow completion');
});

test('permanently failing fallback work reaches failed state and releases meeting memory', async () => {
  const pending = {
    id: 1,
    meeting_id: 'meeting-fallback',
    chunk_id: 42,
    status: 'pending',
    retry_count: -1,
  };
  const db = {
    prepare(sql) {
      if (sql.includes("status = 'pending' WHERE status = 'processing'")) {
        return { run: () => ({ changes: 0 }) };
      }
      if (sql.includes('SELECT * FROM embedding_queue')) {
        return { get: () => (pending.status === 'pending' && pending.retry_count < 3 ? { ...pending } : undefined) };
      }
      if (sql.includes("SET status = 'processing'")) {
        return { run: () => { pending.status = 'processing'; return { changes: 1 }; } };
      }
      if (sql.includes("SET status = 'failed'")) {
        return {
          run: (retryCount) => {
            pending.status = 'failed';
            pending.retry_count = retryCount;
            return { changes: 1 };
          },
        };
      }
      if (sql.includes("SET status = 'pending', retry_count = ?")) {
        return {
          run: (retryCount) => {
            pending.status = 'pending';
            pending.retry_count = retryCount;
            return { changes: 1 };
          },
        };
      }
      if (sql.includes('retry_count = retry_count + 1')) {
        return {
          run: () => {
            pending.status = 'pending';
            pending.retry_count += 1;
            return { changes: 1 };
          },
        };
      }
      if (sql.includes("status IN ('pending', 'processing')")) {
        return {
          get: () => ({ count: ['pending', 'processing'].includes(pending.status) ? 1 : 0 }),
        };
      }
      throw new Error(`unexpected SQL: ${sql}`);
    },
  };
  const pipeline = new EmbeddingPipeline(db, {});
  pipeline.ensureInitialized = async () => {};
  pipeline.provider = { name: 'primary' };
  pipeline.fallbackProvider = { name: 'local-fallback' };
  pipeline.fallbackMeetings.add('meeting-fallback');
  pipeline.embedChunk = async () => { throw new Error('permanent local failure'); };

  await pipeline.processQueue();

  assert.equal(pending.status, 'failed');
  assert.equal(pending.retry_count, 3);
  assert.equal(pipeline.fallbackMeetings.has('meeting-fallback'), false);
});
