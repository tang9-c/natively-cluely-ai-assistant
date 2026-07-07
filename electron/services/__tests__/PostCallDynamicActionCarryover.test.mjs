import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const workflowPath = path.join(root, 'dist-electron/electron/services/post-call/PostCallWorkflow.js');

async function loadWorkflow() {
  return import(pathToFileURL(workflowPath).href);
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
  assert.ok(result.coachingInsights.some((insight) => insight.type === 'accepted_dynamic_action'));
});
