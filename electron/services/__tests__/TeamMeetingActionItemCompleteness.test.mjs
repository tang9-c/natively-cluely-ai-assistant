import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const artifactPath = path.join(root, 'dist-electron/electron/services/dynamic-actions/DynamicActionArtifacts.js');

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
