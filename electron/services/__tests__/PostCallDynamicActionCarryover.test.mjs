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
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
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
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
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
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
});

test('post-call carryover keeps sales capability confirmations separate from action items', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'sales',
    transcript: [],
    summaryData: { overview: 'Customer asked whether the platform supports SSO and audit export.', actionItems: [] },
    dynamicActionArtifacts: [
      {
        actionId: 'capability_child_1',
        parentActionId: 'technical_parent_1',
        modeTemplateType: 'sales',
        actionType: 'capability_fit_answer',
        outputType: 'spoken_response',
        structuredSummary: 'We can confirm SSO and audit export based on the security note, then validate the exact IdP and export format in a PoC.',
        missingFields: [],
        groundedSources: [{ evidenceId: 'ev_1', type: 'material', label: 'Security note', status: 'used' }],
        acceptedAt: 1000,
        evaluationResult: 'passed',
        generationStatus: 'completed',
      },
      {
        actionId: 'capability_child_2',
        parentActionId: 'technical_parent_2',
        modeTemplateType: 'sales',
        actionType: 'capability_fit_answer',
        outputType: 'spoken_response',
        structuredSummary: '资料不足，先不要承诺 ROI 或自动写回。建议用客户样本做一次只读验证。',
        missingFields: [],
        groundedSources: [{ type: 'material', label: 'case search', status: 'not_found' }],
        acceptedAt: 1001,
        evaluationResult: 'safe_fallback',
        generationStatus: 'completed',
      },
      {
        actionId: 'buying_1',
        modeTemplateType: 'sales',
        actionType: 'buying_signal',
        outputType: 'action_item',
        structuredSummary: 'Owner: Mei\nDeliverable: schedule security PoC\nDue: Friday',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
        acceptedAt: 1002,
        generationStatus: 'completed',
      },
    ],
  });

  assert.equal(result.acceptedCapabilityFitRecords.length, 2);
  assert.equal(result.acceptedCapabilityFitRecords[0].parentActionId, 'technical_parent_1');
  assert.equal(result.acceptedCapabilityFitRecords[0].groundingStatus, 'grounded');
  assert.equal(result.acceptedCapabilityFitRecords[1].groundingStatus, 'needs_confirmation');
  assert.ok(result.actionItemsStructured.some((item) => /schedule security PoC/i.test(item.text)));
  assert.equal(
    result.actionItemsStructured.some((item) => /SSO and audit export based on the security note/i.test(item.text)),
    false,
  );
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
});

test('post-call carryover preserves accepted FDE grounded answers without action item pollution', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'fde',
    transcript: [{ speaker: 'Customer', text: 'ECO 流程需要 AI 帮忙检查缺字段，但质量经理要做人审。', timestamp: 1 }],
    summaryData: { overview: 'FDE process review.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'fde_grounded_1',
      parentActionId: 'fde_parent_1',
      modeTemplateType: 'fde',
      actionType: 'fde_grounded_answer',
      outputType: 'spoken_response',
      structuredSummary: '可以确认 ECO 流程里 AI 适合检查缺字段；质量经理仍需要做人审。建议用 3 条真实 ECO 和测试数据验证验收标准。',
      missingFields: [],
      groundedSources: [{ evidenceId: 'ev-fde', type: 'material', label: 'fde-process.pdf', status: 'used' }],
      acceptedAt: 1000,
      evaluationResult: 'passed',
      generationStatus: 'completed',
    }],
  });

  assert.equal(result.acceptedFdeRecords.length, 1);
  assert.match(result.acceptedFdeRecords[0].summary, /ECO 流程/);
  assert.match(result.acceptedFdeRecords[0].groundedSourceLabels.join(' '), /fde-process\.pdf/);
  assert.equal(result.actionItemsStructured.some((item) => /检查缺字段/.test(item.text)), false);
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
});

test('recruiting evidence is internal and never copied into candidate follow-up draft', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'recruiting',
    transcript: [{ speaker: 'interviewer', text: '我负责灰度方案，结果指标还需要核实。', timestamp: 1 }],
    summaryData: { overview: 'Recruiting interview.', actionItems: [] },
    dynamicActionArtifacts: [{
      actionId: 'recruiting-evidence-1',
      parentActionId: 'recruiting-parent-1',
      modeTemplateType: 'recruiting',
      actionType: 'candidate_evidence_summary',
      sourceIntent: 'recruiting_bei_evidence_gap',
      outputType: 'checklist',
      generationStatus: 'completed',
      structuredSummary: '已观察证据：候选人负责灰度方案。待验证：结果指标。',
      groundedSources: [],
      missingFields: ['result_metric'],
      acceptedAt: 1,
    }],
  });

  assert.equal(result.acceptedRecruitingRecords.length, 1);
  assert.equal(result.acceptedRecruitingRecords[0].sourceIntent, 'recruiting_bei_evidence_gap');
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
});

test('post-call carryover emits FDE AI boundary, validation, and risk insights', async () => {
  const { buildPostCallEnhancements } = await loadWorkflow();
  const result = buildPostCallEnhancements({
    modeTemplateType: 'fde',
    transcript: [],
    summaryData: { overview: 'FDE delivery review.', actionItems: [] },
    dynamicActionArtifacts: [
      {
        actionId: 'fde_agent_1',
        modeTemplateType: 'fde',
        actionType: 'fde_agent_feasibility',
        outputType: 'checklist',
        structuredSummary: 'AI Agent 只能只读提示 CAPA 证据缺口，需要质量经理人工确认，不自动写回 QMS。',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
        acceptedAt: 1000,
        generationStatus: 'completed',
      },
      {
        actionId: 'fde_next_1',
        modeTemplateType: 'fde',
        actionType: 'fde_next_step',
        outputType: 'checklist',
        structuredSummary: '需要确认 owner、date、artifact、test data 和 acceptance criteria。',
        missingFields: ['owner', 'date', 'artifact', 'test_data', 'acceptance_criteria'],
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
        acceptedAt: 1001,
        generationStatus: 'completed',
      },
      {
        actionId: 'fde_risk_1',
        modeTemplateType: 'fde',
        actionType: 'fde_risk_blocker',
        outputType: 'checklist',
        structuredSummary: '风险：客户 CAPA 流程 owner 不明确，会影响上线验证。',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
        acceptedAt: 1002,
        generationStatus: 'completed',
      },
    ],
  });

  assert.equal(result.acceptedFdeRecords.length, 3);
  assert.ok(result.acceptedFdeRecords.some((record) => record.actionType === 'fde_agent_feasibility'));
  assert.ok(result.acceptedFdeRecords.some((record) => record.actionType === 'fde_next_step'));
  assert.ok(result.acceptedFdeRecords.some((record) => record.actionType === 'fde_risk_blocker'));
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
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
  assert.deepEqual(result.coachingInsights, []);
  assert.equal(result.followUpDraft, '');
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
    assert.deepEqual(result.coachingInsights, []);
    assert.equal(result.followUpDraft, '');
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
