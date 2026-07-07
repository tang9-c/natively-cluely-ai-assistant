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

function readTree(relativePath, extensions = new Set(['.ts', '.tsx', '.js', '.jsx'])) {
  const base = path.join(root, relativePath);
  const entries = fs.readdirSync(base, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(base, entry.name);
    if (entry.isDirectory()) {
      return readTree(path.relative(root, fullPath), extensions);
    }
    if (!entry.isFile() || !extensions.has(path.extname(entry.name))) {
      return [];
    }
    return fs.readFileSync(fullPath, 'utf8');
  });
}

test('dynamic action artifacts remain transient and do not add durable artifact schema', () => {
  const db = read('electron/db/DatabaseManager.ts');
  const artifact = read('electron/services/dynamic-actions/DynamicActionArtifacts.ts');
  const rendererFiles = readTree('src').join('\n');

  assert.doesNotMatch(db, /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:dynamic_action_artifacts|action_artifacts)/i);
  assert.doesNotMatch(db, /ALTER TABLE\s+(?:dynamic_action_artifacts|action_artifacts|meetings|ai_interactions)[\s\S]{0,200}(artifact|dynamic_action)/i);
  assert.doesNotMatch(db, /ALTER TABLE\s+(meetings|ai_interactions)[\s\S]{0,160}(artifact|dynamic_action)/i);
  assert.doesNotMatch(rendererFiles, /localStorage\.(setItem|getItem)[\s\S]{0,160}(artifact|dynamic_action)/i);
  assert.match(artifact, /not a persisted database record|transient/i);
});
