import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const helperPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js');

async function loadHelper() {
  return import(pathToFileURL(helperPath).href);
}

function action(overrides = {}) {
  return {
    id: 'action_1',
    modeTemplateType: 'team-meet',
    type: 'action_item',
    productContract: { outputType: 'action_item' },
    status: 'completed',
    createdAt: 1000,
    latestTurn: 'Maya will send the launch checklist by Friday.',
    ...overrides,
  };
}

test('builds artifact from completed dynamic action and nearest usage answer', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({
    actions: [action()],
    usage: [{
      type: 'assist',
      timestamp: 1200,
      question: 'dynamic action',
      answer: 'Owner: Maya\\nDeliverable: launch checklist\\nDue: Friday',
      metadata: { source: 'dynamic_action', actionId: 'action_1', groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }] },
    }],
  });

  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].actionId, 'action_1');
  assert.equal(artifacts[0].generationStatus, 'completed');
  assert.match(artifacts[0].structuredSummary, /Owner: Maya/);
  assert.deepEqual(artifacts[0].missingFields, []);
  assert.deepEqual(artifacts[0].groundedSources, [
    { type: 'transcript', label: 'accepted action', status: 'used' },
  ]);
});

test('does not use ordinary assist usage without dynamic_action metadata', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({
    actions: [action()],
    usage: [{
      type: 'assist',
      timestamp: 1200,
      question: 'dynamic action',
      answer: 'Owner: Maya\\nDeliverable: launch checklist\\nDue: Friday',
      metadata: {},
    }],
  });

  assert.equal(artifacts[0].actionId, 'action_1');
  assert.equal(artifacts[0].generationStatus, 'not_generated');
  assert.equal(artifacts[0].structuredSummary, action().latestTurn);
  assert.match(artifacts[0].structuredSummary, /Maya will send/);
  assert.ok(!/Owner: Maya/.test(artifacts[0].structuredSummary));
});

test('builds conservative not_generated artifact when usage is missing', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({ actions: [action({ status: 'accepted' })], usage: [] });
  assert.equal(artifacts[0].generationStatus, 'not_generated');
  assert.match(artifacts[0].structuredSummary, /Maya will send/);
});

test('prefers failure usage metadata over accepted placeholder usage for the same action', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({
    actions: [action({ status: 'generated_failed' })],
    usage: [
      {
        question: '确认负责人和截止时间',
        answer: null,
        timestamp: 100,
        metadata: {
          source: 'dynamic_action',
          actionId: 'action_1',
          generationStatus: 'accepted',
        },
      },
      {
        question: 'fde_agent_feasibility',
        answer: null,
        timestamp: 120,
        metadata: {
          source: 'dynamic_action',
          actionId: 'action_1',
          generationStatus: 'generated_failed',
        },
      },
    ],
  });

  assert.equal(artifacts[0].generationStatus, 'generated_failed');
  assert.equal(artifacts[0].structuredSummary, action({ status: 'generated_failed' }).latestTurn);
});

test('derives missing fields deterministically for team actions', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({
    actions: [action({ latestTurn: 'Someone should follow up.' })],
    usage: [],
  });
  assert.ok(artifacts[0].missingFields.includes('owner'));
  assert.ok(artifacts[0].missingFields.includes('due_date'));
});

test('keeps auto countdown source separate from generation status', async () => {
  const { buildDynamicActionArtifacts } = await loadHelper();
  const artifacts = buildDynamicActionArtifacts({
    actions: [action({ status: 'auto_generated', triggerSource: 'auto_countdown' })],
    usage: [{
      type: 'assist',
      timestamp: 1200,
      question: 'dynamic action',
      answer: 'Owner: Maya\\nDeliverable: launch checklist\\nDue: Friday',
      metadata: {
        source: 'dynamic_action',
        actionId: 'action_1',
        generationStatus: 'completed',
        triggerSource: 'auto_countdown',
        groundedSources: [{ type: 'transcript', label: 'accepted action', status: 'used' }],
      },
    }],
  });

  assert.equal(artifacts[0].generationStatus, 'completed');
  assert.equal(artifacts[0].acceptTriggerSource, 'auto_countdown');
});
