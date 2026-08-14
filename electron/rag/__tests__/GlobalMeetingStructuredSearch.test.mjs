import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

const { RAGManager } = await import(
  pathToFileURL(path.resolve('dist-electron/electron/rag/RAGManager.js')).href
);

test('structured global meeting search groups retriever hits with meeting metadata without an LLM', async () => {
  const manager = Object.create(RAGManager.prototype);
  const retrievalCalls = [];
  manager.retriever = {
    async searchGlobalMeetings(query, options) {
      retrievalCalls.push({ query, options });
      return [
        { id: 1, meetingId: 'meeting-a', text: '数字化移交需要验收', finalScore: 0.9 },
        { id: 2, meetingId: 'meeting-b', text: '另一个数字化移交会议', finalScore: 0.8 },
      ];
    },
  };
  manager.db = {
    prepare() {
      return {
        get(meetingId) {
          return meetingId === 'meeting-a'
            ? { id: meetingId, title: '交付会议', start_time: 100 }
            : { id: meetingId, title: '验收会议', start_time: 200 };
        },
      };
    },
  };
  Object.defineProperty(manager, 'llmHelper', {
    get() {
      throw new Error('structured search must not access the LLM');
    },
  });

  const hits = await manager.searchGlobalMeetings('数字化移交', 5);

  assert.deepEqual(retrievalCalls, [{ query: '数字化移交', options: { limit: 5 } }]);
  assert.deepEqual(hits, [
    {
      meetingId: 'meeting-a',
      title: '交付会议',
      startTimeMs: 100,
      snippet: '数字化移交需要验收',
      score: 0.9,
    },
    {
      meetingId: 'meeting-b',
      title: '验收会议',
      startTimeMs: 200,
      snippet: '另一个数字化移交会议',
      score: 0.8,
    },
  ]);
});
