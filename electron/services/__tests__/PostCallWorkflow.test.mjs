import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workflowPath = path.resolve(__dirname, '../../../dist-electron/electron/services/post-call/PostCallWorkflow.js');
const {
  buildPostCallEnhancements,
  extractStructuredActionItems,
  buildFollowUpDraft,
  generateCoachingInsights,
} = await import(pathToFileURL(workflowPath).href);

test('fde post-call patterns are specialized for manufacturing PLM QMS delivery', () => {
  const sourcePath = path.resolve(__dirname, '../../../electron/services/post-call/PostCallWorkflow.ts');
  const source = fs.readFileSync(sourcePath, 'utf8');

  assert.match(source, /FDE_INTEGRATION_PATTERN[\s\S]*PLM[\s\S]*QMS[\s\S]*ERP[\s\S]*MES/);
  assert.match(source, /FDE_SECURITY_PATTERN[\s\S]*quality record|FDE_SECURITY_PATTERN[\s\S]*质量记录/);
  assert.match(source, /FDE_NEXT_STEP_PATTERN[\s\S]*validation artifact|FDE_NEXT_STEP_PATTERN[\s\S]*验收标准/);
  assert.doesNotMatch(source, /FDE_INTEGRATION_PATTERN[\s\S]*Salesforce|FDE_INTEGRATION_PATTERN[\s\S]*Slack/);
});

test('extractStructuredActionItems captures owner, deadline, and stable ids', () => {
  const items = extractStructuredActionItems([
    { speaker: 'user', text: 'I will send the pricing proposal by Friday.', timestamp: 1200 },
    { speaker: 'interviewer', text: 'ACTION: schedule procurement review before next Tuesday.', timestamp: 2400 },
  ]);

  assert.equal(items.length, 2);
  assert.equal(items[0].id, 'action_1');
  assert.equal(items[0].owner, 'Me');
  assert.equal(items[0].text, 'send the pricing proposal');
  assert.equal(items[0].deadline, 'Friday');
  assert.equal(items[0].sourceTimestamp, 1200);
  assert.equal(items[1].id, 'action_2');
  assert.match(items[1].text, /schedule procurement review/i);
});

test('extractStructuredActionItems merges summary action items without duplicates', () => {
  const items = extractStructuredActionItems(
    [{ speaker: 'user', text: 'I will send the recap.', timestamp: 10 }],
    ['send the recap', 'share the deck']
  );

  assert.deepEqual(items.map(item => item.text), ['send the recap', 'share the deck']);
});

test('buildFollowUpDraft includes overview and structured next steps', () => {
  const draft = buildFollowUpDraft('sales', [
    { id: 'action_1', text: 'send the proposal', owner: 'Me', deadline: 'Friday' },
  ], { overview: 'We aligned on a pilot scope.' });

  assert.match(draft, /Thanks for the conversation today/);
  assert.match(draft, /We aligned on a pilot scope/);
  assert.match(draft, /- Me: send the proposal by Friday/);
});

test('generateCoachingInsights flags sales objection with no captured objection section', () => {
  const insights = generateCoachingInsights([
    { speaker: 'interviewer', text: 'The pricing is too expensive compared with our current vendor.', timestamp: 1 },
    { speaker: 'user', text: 'I can follow up later.', timestamp: 2 },
  ], 'sales', { sections: [{ title: 'Objections', bullets: [] }] });

  assert.ok(insights.some(insight => insight.type === 'missed_objection'));
  assert.ok(insights.some(insight => insight.evidence?.includes('pricing is too expensive')));
});

test('generateCoachingInsights flags Chinese sales objection with no captured objection section', () => {
  const insights = generateCoachingInsights([
    { speaker: 'interviewer', text: '这个价格太高了，我们预算不够。', timestamp: 1 },
    { speaker: 'user', text: '我会发一个案例给你。', timestamp: 2 },
  ], 'sales', { sections: [{ title: 'Objections', bullets: [] }] });

  assert.ok(insights.some(insight => insight.type === 'missed_objection'));
  assert.ok(insights.some(insight => insight.evidence?.includes('价格太高')));
});

test('buildPostCallEnhancements extracts Chinese sales next steps into follow-up draft', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'sales',
    transcript: [
      { speaker: 'interviewer', text: '下一步请发案例和报价单，我们再安排时间看合同。', timestamp: 10 },
    ],
    summaryData: { overview: '客户要求补充案例和报价。', actionItems: [] },
  });

  assert.ok(result.actionItemsStructured.some(item => /发案例和报价单/.test(item.text)));
  assert.match(result.followUpDraft, /Next steps:/);
  assert.match(result.followUpDraft, /发案例和报价单/);
  assert.ok(!result.coachingInsights.some(insight => insight.type === 'missing_next_step'));
});

test('buildPostCallEnhancements extracts Chinese team-meet actions and coaching signals', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [
      { speaker: 'speaker', text: '这个任务我来负责，周五前完成。我们决定用 Postgres。现在有个前端依赖风险。', timestamp: 10 },
    ],
    summaryData: { overview: '团队确定了负责人和技术选择。', actionItems: [] },
  });

  assert.ok(result.actionItemsStructured.some(item => /我来负责/.test(item.text)));
  assert.ok(result.actionItemsStructured.some(item => item.deadline === '周五前'));
  assert.ok(result.coachingInsights.some(insight => insight.type === 'decision_captured'));
  assert.ok(result.coachingInsights.some(insight => insight.type === 'risk_captured'));
  assert.ok(!result.coachingInsights.some(insight => insight.type === 'missing_ownership'));
});

test('buildPostCallEnhancements keeps team-meet behavior unchanged without artifacts', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [
      { speaker: 'speaker', text: '这个任务我来负责，周五前完成。', timestamp: 10 },
    ],
    summaryData: { overview: '团队确认了负责人。', actionItems: [] },
  });

  assert.ok(result.actionItemsStructured.some((item) => /我来负责/.test(item.text)));
  assert.ok(!result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
});

test('buildPostCallEnhancements carries accepted team artifacts even when generation failed', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'team-meet',
    transcript: [
      { speaker: 'speaker', text: '这个任务我来负责，周五前完成。', timestamp: 10 },
    ],
    summaryData: { overview: '团队确认了负责人。', actionItems: [] },
    dynamicActionArtifacts: [
      {
        actionId: 'action_1',
        modeTemplateType: 'team-meet',
        actionType: 'action_item',
        outputType: 'action_item',
        structuredSummary: 'Owner: Maya\nDeliverable: launch checklist\nDue: Friday',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
        acceptedAt: 1000,
        generationStatus: 'completed',
      },
      {
        actionId: 'action_2',
        modeTemplateType: 'team-meet',
        actionType: 'action_item',
        outputType: 'action_item',
        structuredSummary: 'Owner: Maya\nDeliverable: fallback checklist\nDue: Friday',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
        acceptedAt: 1001,
        generationStatus: 'generated_failed',
      },
    ],
  });

  assert.ok(result.actionItemsStructured.some((item) => /launch checklist/i.test(item.text)));
  assert.ok(result.actionItemsStructured.some((item) => /fallback checklist/i.test(item.text)));
  assert.ok(result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
});

test('sales post-call carries accepted quote and proof artifacts into follow-up', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'sales',
    transcript: [{ speaker: 'Customer', text: '请会后发报价和类似案例。', timestamp: 10 }],
    dynamicActionArtifacts: [
      {
        actionId: 'a_quote',
        modeTemplateType: 'sales',
        actionType: 'pricing_request',
        outputType: 'email_draft',
        structuredSummary: 'Hi [CUSTOMER_NAME],\n\nFollowing up with the requested quote...',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'accepted quote draft', status: 'used' }],
        acceptedAt: 1000,
        generationStatus: 'completed',
      },
      {
        actionId: 'a_case',
        modeTemplateType: 'sales',
        actionType: 'case_study_request',
        outputType: 'spoken_response',
        structuredSummary: 'The provided case study mentions Halcyon Industries.',
        missingFields: [],
        groundedSources: [{ type: 'material', label: 'case-study.md', status: 'used' }],
        acceptedAt: 1001,
        generationStatus: 'completed',
      },
    ],
  });

  const text = JSON.stringify(result);
  assert.match(text, /quote|报价|pricing_request/i);
  assert.match(text, /case|案例|case_study_request/i);
  assert.match(text, /Halcyon Industries/);
});

test('sales post-call flags buying signal when owner date or artifact is missing', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'sales',
    transcript: [{ speaker: 'Customer', text: '下一步我们让法务看看合同。', timestamp: 20 }],
    dynamicActionArtifacts: [
      {
        actionId: 'a_buy',
        modeTemplateType: 'sales',
        actionType: 'buying_signal',
        outputType: 'action_item',
        structuredSummary: 'Great, I can send the contract summary after the call.',
        missingFields: ['owner', 'date', 'artifact'],
        groundedSources: [{ type: 'transcript', label: 'accepted next step', status: 'used' }],
        acceptedAt: 1002,
        generationStatus: 'completed',
      },
    ],
  });

  assert.ok(result.coachingInsights.some((insight) =>
    insight.type === 'sales_next_step_missing_fields'
    && /owner|date|artifact|负责人|日期|产物/i.test(insight.detail)
  ));
});

test('sales post-call carries all five accepted sales action artifacts', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'sales',
    transcript: [{ speaker: 'Customer', text: '价格高，想要报价、案例、SSO 信息，下一步法务看合同。', timestamp: 10 }],
    summaryData: { overview: '客户要求价格、报价、案例、技术和下一步。', actionItems: [] },
    dynamicActionArtifacts: [
      {
        actionId: 'a_price',
        modeTemplateType: 'sales',
        actionType: 'pricing_objection',
        outputType: 'spoken_response',
        structuredSummary: 'Acknowledge budget concern and propose a small validation pilot.',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'pricing objection', status: 'used' }],
        acceptedAt: 1000,
        generationStatus: 'completed',
      },
      {
        actionId: 'a_quote',
        modeTemplateType: 'sales',
        actionType: 'pricing_request',
        outputType: 'email_draft',
        structuredSummary: 'Hi [CUSTOMER_NAME], following up with the approved proposal draft.',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'quote request', status: 'used' }],
        acceptedAt: 1001,
        generationStatus: 'completed',
      },
      {
        actionId: 'a_case',
        modeTemplateType: 'sales',
        actionType: 'case_study_request',
        outputType: 'spoken_response',
        structuredSummary: 'case-study.md mentions Halcyon Industries pilot validation.',
        missingFields: [],
        groundedSources: [{ type: 'material', label: 'case-study.md', status: 'used' }],
        acceptedAt: 1002,
        generationStatus: 'completed',
      },
      {
        actionId: 'a_tech',
        modeTemplateType: 'sales',
        actionType: 'technical_requirements',
        outputType: 'checklist',
        structuredSummary: 'Checklist: API, SSO, security, production environment, validation owner.',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'technical requirement', status: 'used' }],
        acceptedAt: 1003,
        generationStatus: 'completed',
      },
      {
        actionId: 'a_buy',
        modeTemplateType: 'sales',
        actionType: 'buying_signal',
        outputType: 'action_item',
        structuredSummary: 'Owner: Maya\nDeliverable: contract review packet\nDue: Friday',
        missingFields: [],
        groundedSources: [{ type: 'transcript', label: 'buying signal', status: 'used' }],
        acceptedAt: 1004,
        generationStatus: 'completed',
      },
    ],
  });

  const text = JSON.stringify(result);
  assert.match(text, /pricing|budget|价格|pilot/i);
  assert.match(text, /quote|proposal|报价/i);
  assert.match(text, /Halcyon Industries|case-study/i);
  assert.match(text, /API|SSO|security|production/i);
  assert.match(text, /contract review packet|Friday/i);
});

test('buildPostCallEnhancements handles Chinese recruiting logistics and follow-up', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'recruiting',
    transcript: [
      { speaker: 'candidate', text: '候选人问薪资、签证和入职时间，后续请安排下一轮面试并发 JD。', timestamp: 20 },
    ],
    summaryData: { overview: '候选人关注 logistics。', actionItems: [] },
  });

  assert.ok(result.actionItemsStructured.some(item => /安排下一轮面试/.test(item.text)));
  assert.ok(result.actionItemsStructured.some(item => /发 JD/.test(item.text)));
  assert.ok(!result.coachingInsights.some(insight => insight.type === 'missing_logistics'));
});

test('recruiting follow-up never exposes English or Chinese internal evaluation content', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'recruiting',
    transcript: [],
    summaryData: { overview: 'Thank you for speaking with us.', actionItems: [] },
    dynamicActionArtifacts: [
      {
        actionId: 'recruiting-probe-1',
        modeTemplateType: 'recruiting',
        actionType: 'candidate_experience_probe',
        sourceIntent: 'recruiting_scorecard_gap',
        outputType: 'checklist',
        structuredSummary: 'Scorecard gap: verify risk ownership before any hire or reject decision.',
        missingFields: ['risk_ownership'],
        groundedSources: [],
        acceptedAt: 1,
        generationStatus: 'completed',
      },
      {
        actionId: 'recruiting-interest-1',
        modeTemplateType: 'recruiting',
        actionType: 'strong_fit_signal',
        sourceIntent: 'recruiting_candidate_interest',
        outputType: 'spoken_response',
        structuredSummary: '候选人对岗位表示兴趣；不要写录用、淘汰、年龄或性别。',
        missingFields: [],
        groundedSources: [],
        acceptedAt: 2,
        evaluationResult: 'safe_fallback',
        generationStatus: 'completed',
      },
    ],
  });

  assert.equal(result.acceptedRecruitingRecords.length, 2);
  assert.ok(result.coachingInsights.some((item) => item.type === 'recruiting_evidence_gap'));
  assert.ok(result.coachingInsights.some((item) => item.type === 'recruiting_candidate_interest'));
  assert.ok(result.coachingInsights.some((item) => item.type === 'recruiting_policy_confirmation_needed'));
  assert.doesNotMatch(result.followUpDraft, /scorecard|risk|hire|reject|录用|淘汰|年龄|性别|age|gender/i);
});

test('fde post-call insights flag customer goal without success metric', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'fde',
    transcript: [
      { speaker: 'Customer', text: '我们的目标是减少人工审批工作，但暂时还没定义上线后怎么衡量。', timestamp: 1 },
    ],
    summaryData: { sections: [] },
  });

  assert.ok(result.coachingInsights.some(insight => insight.type === 'missing_success_metric'));
  assert.ok(result.coachingInsights.some(insight => insight.type === 'missing_delivery_next_step'));
});

test('fde post-call insights detect integration ownership, security, scope, and emotion signals', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'fde',
    transcript: [
      { speaker: 'Customer', text: '我们担心质量记录和审计追踪，第一阶段能不能也把 PLM、QMS、ERP 和 MES 的只读集成跑通？', timestamp: 1 },
    ],
    summaryData: { sections: [] },
  });

  assert.ok(result.coachingInsights.some(insight => insight.type === 'missing_integration_owner'));
  assert.ok(result.coachingInsights.some(insight => insight.type === 'security_risk_captured'));
  assert.ok(result.coachingInsights.some(insight => insight.type === 'scope_change_detected'));
  assert.ok(result.coachingInsights.some(insight => insight.type === 'emotion_signal_detected'));
  assert.match(result.followUpDraft, /^Hi,/);
});

test('generateCoachingInsights flags Chinese lecture study follow-up', () => {
  const insights = generateCoachingInsights([
    { speaker: 'teacher', text: '今天作业是阅读第三章，下周有测验。', timestamp: 30 },
  ], 'lecture');

  assert.ok(insights.some(insight => insight.type === 'study_follow_up'));
  assert.ok(insights.some(insight => /阅读第三章/.test(insight.evidence || '')));
});

test('generateCoachingInsights flags Chinese interview and technical uncertainty patterns', () => {
  const interview = generateCoachingInsights([
    { speaker: 'candidate', text: '我不确定这个回答，可以补一个项目例子。', timestamp: 40 },
  ], 'looking-for-work');
  const technical = generateCoachingInsights([
    { speaker: 'candidate', text: '我不会这个优化，复杂度还不确定。', timestamp: 50 },
  ], 'technical-interview');

  assert.ok(interview.some(insight => insight.type === 'uncertainty_pattern'));
  assert.ok(interview.some(insight => /不确定/.test(insight.evidence || '')));
  assert.ok(technical.some(insight => insight.type === 'uncertainty_pattern'));
  assert.ok(technical.some(insight => /不会/.test(insight.evidence || '')));
});

test('generateCoachingInsights uses mode-specific coaching rules', () => {
  const recruiting = generateCoachingInsights([
    { speaker: 'interviewer', text: 'Tell me about your backend work.', timestamp: 1 },
  ], 'recruiting');
  const team = generateCoachingInsights([
    { speaker: 'interviewer', text: 'We agreed to change the launch plan.', timestamp: 1 },
  ], 'team-meet');

  assert.ok(recruiting.some(insight => insight.type === 'missing_logistics'));
  assert.ok(team.some(insight => insight.type === 'missing_ownership'));
});

test('buildPostCallEnhancements returns schema v2 payload', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'lecture',
    transcript: [{ speaker: 'interviewer', text: 'Read chapter 4 before Friday.', timestamp: 10 }],
    summaryData: { overview: 'Lecture covered graph traversal.', actionItems: [] },
  });

  assert.equal(result.schemaVersion, 2);
  assert.ok(Array.isArray(result.actionItemsStructured));
  assert.ok(result.followUpDraft.includes('Lecture covered graph traversal'));
  assert.ok(result.coachingInsights.some(insight => insight.type === 'study_follow_up'));
});

test('post-call schema remains JSON-safe and excludes raw transcript fields', () => {
  const result = buildPostCallEnhancements({
    modeTemplateType: 'sales',
    transcript: [
      { speaker: 'prospect', text: 'The pricing is too expensive for ACME secret budget.', timestamp: 10 },
      { speaker: 'user', text: 'I will send the proposal by Friday.', timestamp: 20 },
    ],
    summaryData: { overview: 'Discussed a pilot.', actionItems: [] },
  });

  assert.deepEqual(Object.keys(result).sort(), [
    'acceptedActionItems',
    'acceptedBlockerRecords',
    'acceptedCapabilityFitRecords',
    'acceptedDecisionRecords',
    'acceptedFdeRecords',
    'acceptedRecruitingRecords',
    'actionItemsStructured',
    'coachingInsights',
    'followUpDraft',
    'schemaVersion',
  ]);
  assert.equal(result.schemaVersion, 2);
  assert.doesNotThrow(() => JSON.stringify(result));
  assert.equal('transcript' in result, false);
  assert.equal('rawTranscript' in result, false);
});

test('structured action items cap at eight and keep deterministic ids after dedupe', () => {
  const transcript = Array.from({ length: 12 }, (_, index) => ({
    speaker: 'user',
    text: `I will prepare follow up item ${index + 1} by Friday.`,
    timestamp: index + 1,
  }));

  const items = extractStructuredActionItems(transcript, ['prepare follow up item 1']);

  assert.equal(items.length, 8);
  assert.deepEqual(items.map(item => item.id), [
    'action_1',
    'action_2',
    'action_3',
    'action_4',
    'action_5',
    'action_6',
    'action_7',
    'action_8',
  ]);
  assert.equal(items.filter(item => item.text === 'prepare follow up item 1').length, 1);
});
