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
