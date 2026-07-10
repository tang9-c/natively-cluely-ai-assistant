import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const workflowPath = path.join(root, 'dist-electron/electron/services/post-call/PostCallWorkflow.js');
const meetingPersistencePath = path.join(root, 'dist-electron/electron/MeetingPersistence.js');

async function loadWorkflow() {
  return import(pathToFileURL(workflowPath).href);
}

async function loadMeetingPersistence() {
  return import(pathToFileURL(meetingPersistencePath).href);
}

test('post-call summary preserves accepted team action artifacts', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [{ speaker: 'Maya', text: 'I can send the checklist.', timestamp: 1 }],
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'action_1',
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: 'Owner: Maya\nDeliverable: launch checklist\nDue: Friday',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000,
      generationStatus: 'completed',
    }],
  });

  assert.ok(result.actionItemsStructured.some((item) => /launch checklist/i.test(item.text)));
  assert.ok(result.acceptedActionItems.some((item) => /launch checklist/i.test(item.text)));
  assert.ok(result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
});

test('post-call carryover preserves accepted team decision artifacts', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [],
    summaryData: { overview: 'Architecture review.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'decision_1',
      modeTemplateType: 'team-meet',
      actionType: 'decision_point',
      outputType: 'decision_record',
      structuredSummary: 'Decision: 采用 Postgres\nRationale: 团队已有经验\nReversibility: 试点后可回滚',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000,
      generationStatus: 'completed',
    }],
  });

  assert.equal(result.acceptedDecisionRecords.length, 1);
  assert.match(result.acceptedDecisionRecords[0].decision, /Postgres/);
  assert.ok(result.followUpDraft.includes('Postgres'));
});

test('post-call carryover preserves accepted team blocker artifacts', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [],
    summaryData: { overview: 'Launch review.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'blocker_1',
      modeTemplateType: 'team-meet',
      actionType: 'blocker_check',
      outputType: 'checklist',
      structuredSummary: 'Blocker: 等安全审批\nImpact: 发布延期\nDependency: 安全团队\nNext unblock step: 今天确认审批 owner',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000,
      generationStatus: 'completed',
    }],
  });

  assert.equal(result.acceptedBlockerRecords.length, 1);
  assert.match(result.acceptedBlockerRecords[0].blocker, /安全审批/);
  assert.ok(result.followUpDraft.includes('安全审批'));
});

test('MeetingPersistence maps flat dynamic action usage into carryover artifacts', async () => {
  const { buildDynamicActionArtifactActionsFromUsage } = await loadMeetingPersistence();
  const { buildDynamicActionArtifacts } = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js')).href);
  const { buildPostCallEnhancements } = await loadWorkflow();

  const usage = [{
    timestamp: 1700000000123,
    question: '请确认负责人和截止时间',
    answer: 'Owner: Maya\nDeliverable: launch checklist\nDue: Friday',
    metadata: {
      source: 'dynamic_action',
      actionId: 'action_flat_1',
      actionType: 'action_item',
      modeTemplateType: 'team-meet',
      retrievalQuery: 'launch checklist',
      outputType: 'action_item',
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
    },
  }];

  const actions = buildDynamicActionArtifactActionsFromUsage(usage);
  assert.equal(actions.length, 1);
  assert.equal(actions[0].id, 'action_flat_1');
  assert.equal(actions[0].type, 'action_item');
  assert.equal(actions[0].modeTemplateType, 'team-meet');
  assert.equal(actions[0].status, 'completed');
  assert.equal(actions[0].createdAt, 1700000000123);
  assert.equal(actions[0].latestTurn, '请确认负责人和截止时间');
  assert.equal(actions[0].retrievalQuery, 'launch checklist');
  assert.equal(actions[0].productContract.outputType, 'action_item');

  const artifacts = buildDynamicActionArtifacts({ actions, usage });
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [{ speaker: 'Maya', text: 'I can send the checklist.', timestamp: 1 }],
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts: artifacts,
  });

  assert.ok(result.actionItemsStructured.some((item) => /launch checklist/i.test(item.text)));
  assert.ok(result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
});

test('MeetingPersistence skips non-dynamic or incomplete usage entries', async () => {
  const { buildDynamicActionArtifactActionsFromUsage } = await loadMeetingPersistence();

  const actions = buildDynamicActionArtifactActionsFromUsage([
    {
      timestamp: 1,
      question: '普通 usage',
      answer: 'nothing special',
      metadata: {
        source: 'assist',
        actionId: 'action_skip_1',
        actionType: 'action_item',
        modeTemplateType: 'team-meet',
        outputType: 'action_item',
      },
    },
    {
      timestamp: 2,
      question: 'dynamic action missing id',
      answer: 'still nothing',
      metadata: {
        source: 'dynamic_action',
        actionType: 'action_item',
        modeTemplateType: 'team-meet',
        outputType: 'action_item',
      },
    },
  ]);

  assert.deepEqual(actions, []);
});

test('MeetingPersistence preserves accepted placeholder usage as not_generated artifact fallback', async () => {
  const { buildDynamicActionArtifactActionsFromUsage } = await loadMeetingPersistence();
  const { buildDynamicActionArtifacts } = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js')).href);

  const usage = [{
    timestamp: 1700000000123,
    question: '确认负责人和截止时间',
    answer: null,
    metadata: {
      source: 'dynamic_action',
      actionId: 'action_placeholder_1',
      actionType: 'action_item',
      modeTemplateType: 'team-meet',
      retrievalQuery: 'launch checklist',
      outputType: 'action_item',
      generationStatus: 'accepted',
    },
  }];

  const actions = buildDynamicActionArtifactActionsFromUsage(usage);
  const artifacts = buildDynamicActionArtifacts({ actions, usage });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].status, 'accepted');
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].generationStatus, 'not_generated');
  assert.equal(artifacts[0].structuredSummary, '确认负责人和截止时间');
});

test('MeetingPersistence upgrades accepted placeholder usage to generated_failed artifact when failure metadata arrives later', async () => {
  const { buildDynamicActionArtifactActionsFromUsage } = await loadMeetingPersistence();
  const { buildDynamicActionArtifacts } = await import(pathToFileURL(path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js')).href);

  const usage = [
    {
      timestamp: 1700000000123,
      question: '确认负责人和截止时间',
      answer: null,
      metadata: {
        source: 'dynamic_action',
        actionId: 'action_failed_1',
        actionType: 'action_item',
        modeTemplateType: 'team-meet',
        retrievalQuery: 'launch checklist',
        outputType: 'action_item',
        generationStatus: 'accepted',
      },
    },
    {
      timestamp: 1700000001123,
      question: 'action_item',
      answer: null,
      metadata: {
        source: 'dynamic_action',
        actionId: 'action_failed_1',
        actionType: 'action_item',
        modeTemplateType: 'team-meet',
        retrievalQuery: 'launch checklist',
        outputType: 'action_item',
        generationStatus: 'generated_failed',
      },
    },
  ];

  const actions = buildDynamicActionArtifactActionsFromUsage(usage);
  const artifacts = buildDynamicActionArtifacts({ actions, usage });

  assert.equal(actions.length, 1);
  assert.equal(actions[0].status, 'generated_failed');
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].generationStatus, 'generated_failed');
  assert.equal(artifacts[0].structuredSummary, '确认负责人和截止时间');
});

test('post-call carryover preserves accepted fallback artifacts when generation did not complete', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();

  for (const generationStatus of ['generated_failed', 'not_generated']) {
    const result = buildPostCallEnhancements({
      modeTemplateType: 'team-meet',
      transcript: [{ speaker: 'Maya', text: 'We need to follow up on launch readiness.', timestamp: 1 }],
      summaryData: { overview: 'Launch planning.', actionItems: [] },
      dynamicActionArtifacts: [{
        actionId: `action_${generationStatus}`,
        modeTemplateType: 'team-meet',
        actionType: 'action_item',
        outputType: 'action_item',
        structuredSummary: 'Owner: Maya\nDeliverable: launch readiness checklist\nDue: Friday',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
        acceptedAt: 1000,
        generationStatus,
      }],
    });

    assert.ok(
      result.actionItemsStructured.some((item) => /launch readiness checklist/i.test(item.text)),
      `${generationStatus} fallback artifact should remain in post-call action items`,
    );
    assert.ok(
      result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'),
      `${generationStatus} fallback artifact should be reflected in post-call coaching insights`,
    );
  }
});

test('post-call carryover dedupes accepted team artifacts against extracted transcript items', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [{ speaker: 'Maya', text: 'Maya will send the launch checklist by Friday.', timestamp: 1 }],
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'action_1',
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: 'Owner: Maya\nDeliverable: launch checklist\nDue: Friday',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000,
      generationStatus: 'completed',
    }],
  });

  assert.equal(result.actionItemsStructured.length, 1);
  assert.equal(result.actionItemsStructured[0].owner, 'Maya');
  assert.equal(result.actionItemsStructured[0].deadline, 'Friday');
  assert.match(result.actionItemsStructured[0].text, /launch checklist/i);
});

test('post-call carryover does not dedupe numeric suffix collisions from accepted artifacts', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [{ speaker: 'Maya', text: 'Maya will send checklist 1 by Friday.', timestamp: 1 }],
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'action_10',
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: 'Owner: Maya\nDeliverable: checklist 10\nDue: Monday',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1010,
      generationStatus: 'completed',
    }],
  });

  assert.equal(result.actionItemsStructured.length, 2);
  assert.ok(result.actionItemsStructured.some((item) => /checklist 1/i.test(item.text)));
  assert.ok(result.actionItemsStructured.some((item) => /checklist 10/i.test(item.text)));
});

test('post-call carryover parses chinese accepted artifact fields', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [{ speaker: 'Maya', text: '我们需要跟进发布计划。', timestamp: 1 }],
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'action_cn_1',
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: '负责人：Maya\n交付物：发布清单\n截止时间：周五',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1020,
      generationStatus: 'completed',
    }],
  });

  assert.ok(result.actionItemsStructured.some((item) =>
    item.text === '发布清单' && item.owner === 'Maya' && item.deadline === '周五'
  ));
});

test('post-call carryover caps merged team artifacts at eight items', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const transcript = Array.from({ length: 7 }, (_, index) => ({
    speaker: 'Maya',
    text: `Maya will send checklist ${index + 1} by Friday.`,
    timestamp: index + 1,
  }));
  const dynamicActionArtifacts = [
    {
      actionId: 'action_8',
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: 'Owner: Maya\nDeliverable: checklist 8\nDue: Friday',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1008,
      generationStatus: 'completed',
    },
    {
      actionId: 'action_9',
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: 'Owner: Maya\nDeliverable: checklist 9\nDue: Friday',
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1009,
      generationStatus: 'completed',
    },
  ];

  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript,
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts,
  });

  assert.equal(result.actionItemsStructured.length, 8);
  assert.ok(result.actionItemsStructured.some((item) => /checklist 8/i.test(item.text)));
  assert.equal(result.actionItemsStructured.some((item) => /checklist 9/i.test(item.text)), false);
});

test('post-call carryover preserves at least ninety percent of accepted team artifacts across structured sections', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const dynamicActionArtifacts = [
    ...Array.from({ length: 4 }, (_, index) => ({
      actionId: `item_${index + 1}`,
      modeTemplateType: 'team-meet',
      actionType: 'action_item',
      outputType: 'action_item',
      structuredSummary: `Owner: Maya\nDeliverable: checklist ${index + 1}\nDue: Friday`,
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 1000 + index,
      generationStatus: 'completed',
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      actionId: `decision_${index + 1}`,
      modeTemplateType: 'team-meet',
      actionType: 'decision_point',
      outputType: 'decision_record',
      structuredSummary: `Decision: decision ${index + 1}\nRationale: rationale\nReversibility: reversible`,
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 2000 + index,
      generationStatus: 'completed',
    })),
    ...Array.from({ length: 3 }, (_, index) => ({
      actionId: `blocker_${index + 1}`,
      modeTemplateType: 'team-meet',
      actionType: 'blocker_check',
      outputType: 'checklist',
      structuredSummary: `Blocker: blocker ${index + 1}\nImpact: launch delay\nDependency: security\nNext unblock step: confirm owner`,
      missingFields: [],
      groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      acceptedAt: 3000 + index,
      generationStatus: 'completed',
    })),
  ];

  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [],
    summaryData: { overview: 'Launch planning.', actionItems: [] },
    dynamicActionArtifacts,
  });

  const preserved =
    result.acceptedActionItems.length +
    result.acceptedDecisionRecords.length +
    result.acceptedBlockerRecords.length;
  assert.ok(preserved >= 9);
});
