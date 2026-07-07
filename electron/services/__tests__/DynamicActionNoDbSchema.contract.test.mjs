import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('dynamic action artifacts remain transient and do not add durable artifact schema', () => {
  const db = read('electron/db/DatabaseManager.ts');
  const artifact = read('electron/services/dynamic-actions/DynamicActionArtifacts.ts');
  const rendererFiles = [
    'src/components/NativelyInterface.tsx',
    'src/components/dynamic-actions/DynamicActionBar.tsx',
  ].map(read).join('\n');

  assert.doesNotMatch(db, /dynamic_action_artifacts/i);
  assert.doesNotMatch(db, /action_artifact/i);
  assert.doesNotMatch(db, /ALTER TABLE\s+(meetings|ai_interactions)[\s\S]{0,160}(artifact|dynamic_action)/i);
  assert.doesNotMatch(rendererFiles, /localStorage\.(setItem|getItem)[\s\S]{0,160}(artifact|dynamic_action)/i);
  assert.match(artifact, /not a persisted database record|transient/i);
});
