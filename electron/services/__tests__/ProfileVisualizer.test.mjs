import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { transformSync } = require('esbuild');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const sourcePath = path.join(repoRoot, 'src/components/profile/ProfileVisualizer.tsx');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

function extractHelperSource() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const sourceWithoutImports = source
    .replace(/^import[\s\S]*?;\n/gm, '')
    .replace(/export\s+function\s+/g, 'function ');
  const start = sourceWithoutImports.indexOf('function getUniqueSkills');
  const end = sourceWithoutImports.indexOf('export const ProfileVisualizer');
  assert.ok(start >= 0, 'getUniqueSkills helper must exist');
  assert.ok(end > start, 'ProfileVisualizer export must appear after helpers');
  const helperSource = `${sourceWithoutImports.slice(start, end)}
return { getUniqueSkills, getHiddenExperienceCount, normalizeProfileVisualizerData };`;
  return transformSync(helperSource, { loader: 'ts', format: 'cjs' }).code;
}

function loadHelpers() {
  return Function(extractHelperSource())();
}

test('ProfileVisualizer source is not a null placeholder', () => {
  const source = read('src/components/profile/ProfileVisualizer.tsx');

  assert.ok(!/=>\s*null\s*;/.test(source), 'ProfileVisualizer must not be a null placeholder');
  assert.match(source, /Profile 智能/);
  assert.match(source, /经验线索/);
  assert.match(source, /identity\.name|displayName/);
  assert.match(source, /另有/);
  assert.match(source, /条经验未显示/);
});

test('normalizes null profile into inactive empty state', () => {
  const { normalizeProfileVisualizerData } = loadHelpers();
  const normalized = normalizeProfileVisualizerData(null);

  assert.equal(normalized.isActive, false);
  assert.equal(normalized.displayName, '身份未命名');
  assert.equal(normalized.skillCount, 0);
  assert.equal(normalized.hiddenExperienceCount, 0);
  assert.deepEqual(normalized.experiences, []);
});

test('normalizes empty profile object into active empty skeleton', () => {
  const { normalizeProfileVisualizerData } = loadHelpers();
  const normalized = normalizeProfileVisualizerData({});

  assert.equal(normalized.isActive, true);
  assert.equal(normalized.displayName, '身份未命名');
  assert.equal(normalized.experienceCount, 0);
  assert.equal(normalized.projectCount, 0);
  assert.equal(normalized.nodeCount, 0);
  assert.deepEqual(normalized.skills, []);
});

test('preserves preview experiences and computes hidden experience count', () => {
  const { normalizeProfileVisualizerData, getHiddenExperienceCount } = loadHelpers();
  const profileData = {
    experienceCount: 5,
    experiencePreview: [
      { title: 'A', organization: 'Org A' },
      { title: 'B', organization: 'Org B' },
      { title: 'C', organization: 'Org C' },
    ],
  };

  assert.equal(getHiddenExperienceCount(profileData), 2);
  const normalized = normalizeProfileVisualizerData(profileData);
  assert.equal(normalized.hiddenExperienceCount, 2);
  assert.deepEqual(normalized.experiences, profileData.experiencePreview);
});

test('deduplicates skills after trimming empty values', () => {
  const { getUniqueSkills, normalizeProfileVisualizerData } = loadHelpers();

  assert.deepEqual(getUniqueSkills(['a', 'b', 'a', ' ', ' b ']), ['a', 'b']);
  assert.deepEqual(
    normalizeProfileVisualizerData({ skills: ['a', 'b', 'a', ' ', ' b '] }).skills,
    ['a', 'b'],
  );
});
