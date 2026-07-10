import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const artifactPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js');
const evaluatorPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/TeamMeetingAcceptedOutputEvaluator.js');

test('team action artifacts expose missing owner deliverable and due date', async () => {
  const { buildDynamicActionArtifacts } = await import(pathToFileURL(artifactPath).href);
  const [artifact] = buildDynamicActionArtifacts({
    actions: [{
      id: 'a1',
      modeTemplateType: 'team-meet',
      type: 'action_item',
      productContract: { outputType: 'action_item' },
      status: 'accepted',
      createdAt: 1,
      latestTurn: 'Someone should follow up.',
    }],
    usage: [],
  });

  assert.deepEqual(artifact.missingFields.sort(), ['deliverable', 'due_date', 'owner'].sort());
});

test('team action item output requires owner deliverable and due date or explicit missing fields', async () => {
  const { evaluateTeamMeetingAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const result = evaluateTeamMeetingAcceptedOutput({
    actionType: 'action_item',
    answerText: 'Owner: Maya\nDeliverable: 发布 checklist\nDue: 周五',
    missingFields: [],
  });
  assert.equal(result.passed, true);
});

test('team decision output requires decision rationale and reversibility', async () => {
  const { evaluateTeamMeetingAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const result = evaluateTeamMeetingAcceptedOutput({
    actionType: 'decision_point',
    answerText: 'Decision: 采用 Postgres\nRationale: 团队已有运维经验\nReversibility: 可在试点后回滚',
    missingFields: [],
  });
  assert.equal(result.passed, true);
});

test('team blocker output requires impact dependency and unblock step', async () => {
  const { evaluateTeamMeetingAcceptedOutput } = await import(pathToFileURL(evaluatorPath).href);
  const result = evaluateTeamMeetingAcceptedOutput({
    actionType: 'blocker_check',
    answerText: 'Blocker: 等安全审批\nImpact: 发布延期\nDependency: 安全团队\nNext unblock step: 今天确认审批 owner',
    missingFields: [],
  });
  assert.equal(result.passed, true);
});
