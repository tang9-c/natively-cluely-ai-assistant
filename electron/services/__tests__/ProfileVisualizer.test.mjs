import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('ProfileVisualizer renders the parsed profile instead of a null placeholder', () => {
  const source = read('src/components/profile/ProfileVisualizer.tsx');

  assert.ok(
    !/=>\s*null\s*;/.test(source),
    'ProfileVisualizer must not be a null placeholder',
  );
  assert.match(source, /profileData\?\.(identity|experiencePreview|summary|skills)/);
  assert.match(source, /Profile 智能/);
  assert.match(source, /经验线索/);
});
