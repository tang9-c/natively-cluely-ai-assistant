import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

async function loadAssembler() {
  return import(
    pathToFileURL(path.resolve(
      'dist-electron/electron/rag/MeetingEvidenceAssembler.js',
    )).href
  );
}

async function loadRetriever() {
  return import(
    pathToFileURL(path.resolve(
      'dist-electron/electron/rag/RAGRetriever.js',
    )).href
  );
}

function transcriptChunk(id, index, text, meetingId = 'meeting-a') {
  return {
    id,
    meetingId,
    chunkIndex: index,
    speaker: index % 2 === 0 ? '我' : '客户',
    startMs: index * 1000,
    endMs: (index + 1) * 1000,
    text,
    tokenCount: Math.ceil(text.length / 4),
    similarity: 0.8,
  };
}

test('summary evidence uses current meeting overview and key points', async () => {
  const { assembleMeetingEvidence } = await loadAssembler();

  const result = assembleMeetingEvidence({
    meetingId: 'meeting-a',
    intent: 'summary',
    summary: {
      overview: '讨论了采购系统集成',
      keyPoints: ['飞书作为统一入口', 'PTC 负责 PLM'],
    },
    retrievedChunks: [transcriptChunk(1, 0, '补充转录内容')],
    timelineChunks: [],
  });

  assert.match(result.formattedContext, /讨论了采购系统集成/);
  assert.match(result.formattedContext, /飞书作为统一入口/);
  assert.ok(result.evidence.every((item) => item.meetingId === 'meeting-a'));
});

test('summary without structured fields samples the full meeting timeline evenly', async () => {
  const { assembleMeetingEvidence } = await loadAssembler();
  const timelineChunks = Array.from({ length: 12 }, (_, index) =>
    transcriptChunk(index + 1, index, `时间段 ${index}`));

  const result = assembleMeetingEvidence({
    meetingId: 'meeting-a',
    intent: 'summary',
    summary: {},
    retrievedChunks: [],
    timelineChunks,
  });

  assert.match(result.formattedContext, /时间段 0/);
  assert.match(result.formattedContext, /时间段 5|时间段 6/);
  assert.match(result.formattedContext, /时间段 11/);
});

test('action and decision evidence use structured fields and deterministic expansions', async () => {
  const {
    assembleMeetingEvidence,
    expandMeetingRetrievalQuery,
  } = await loadAssembler();

  const actionResult = assembleMeetingEvidence({
    meetingId: 'meeting-a',
    intent: 'action_items',
    summary: { actionItems: ['张三周五前提交方案'] },
    retrievedChunks: [],
    timelineChunks: [],
  });
  const decisionResult = assembleMeetingEvidence({
    meetingId: 'meeting-a',
    intent: 'decision_recall',
    summary: { decisions: ['确定使用飞书作为统一入口'] },
    retrievedChunks: [],
    timelineChunks: [],
  });

  assert.match(actionResult.formattedContext, /张三周五前提交方案/);
  assert.match(decisionResult.formattedContext, /确定使用飞书作为统一入口/);
  assert.match(
    expandMeetingRetrievalQuery('有什么要做', 'action_items', {}),
    /行动项.*下一步.*follow up/s,
  );
  assert.match(
    expandMeetingRetrievalQuery('最终怎么定的', 'decision_recall', {}),
    /决定.*结论.*agreed/s,
  );
  assert.equal(
    expandMeetingRetrievalQuery(
      '有什么要做',
      'action_items',
      { actionItems: ['已有行动项'] },
    ),
    '有什么要做',
  );
});

test('speaker evidence preserves labels, filters other meetings, and respects token budget', async () => {
  const { assembleMeetingEvidence } = await loadAssembler();
  const result = assembleMeetingEvidence({
    meetingId: 'meeting-a',
    intent: 'speaker_lookup',
    summary: {},
    retrievedChunks: [
      transcriptChunk(1, 0, '预算 为 700 万', 'meeting-a'),
      transcriptChunk(2, 1, '预算 为 300 万', 'meeting-b'),
      transcriptChunk(3, 2, '后续 由 张三 跟进', 'meeting-a'),
    ],
    timelineChunks: [],
    maxTokens: 8,
  });

  assert.match(result.formattedContext, /我.*预算 为 700 万/);
  assert.doesNotMatch(result.formattedContext, /300 万/);
  assert.ok(result.totalTokens <= 8);
});

test('meeting query intent detection supports Chinese summary, action, decision, and speaker questions', async () => {
  const { RAGRetriever } = await loadRetriever();
  const retriever = new RAGRetriever({}, {});

  assert.equal(retriever.detectIntent('请总结一下这次会议'), 'summary');
  assert.equal(retriever.detectIntent('下一步由谁负责跟进'), 'action_items');
  assert.equal(retriever.detectIntent('最终决定是什么'), 'decision_recall');
  assert.equal(retriever.detectIntent('谁提到了预算'), 'speaker_lookup');
});
