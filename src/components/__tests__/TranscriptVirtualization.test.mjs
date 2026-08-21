import assert from 'node:assert/strict';
import Module from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { transformSync } from 'esbuild';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '../../..');
const sharedModulePath = path.join(repoRoot, 'shared/transcriptVirtualization.ts');
const compiled = transformSync(fs.readFileSync(sharedModulePath, 'utf8'), {
  loader: 'ts',
  format: 'cjs',
  target: 'es2020',
});
const sharedModule = new Module(sharedModulePath);
sharedModule.filename = sharedModulePath;
sharedModule.paths = Module._nodeModulePaths(path.dirname(sharedModulePath));
sharedModule._compile(compiled.code, sharedModulePath);

const { buildVisibleTranscriptRows, getTranscriptRowKey } = sharedModule.exports;

test('filters non-human rows without mutating the full transcript', () => {
  const transcript = [
    { speaker: 'user', text: 'A', timestamp: 1 },
    { speaker: 'system', text: 'hidden', timestamp: 2 },
    { speaker: 'interviewer', text: 'B', timestamp: 3 },
  ];
  const rows = buildVisibleTranscriptRows(transcript);

  assert.deepEqual(rows.map(row => row.entry.text), ['A', 'B']);
  assert.equal(transcript.length, 3);
});

test('prefers raw segment ids and otherwise creates deterministic unique keys', () => {
  assert.equal(getTranscriptRowKey({
    speaker: 'user', text: 'A', timestamp: 1, rawSegmentIds: ['raw-1', 'raw-2'],
  }, 0), 'raw:raw-1|raw-2');
  assert.notEqual(
    getTranscriptRowKey({ speaker: 'user', text: 'same', timestamp: 1 }, 0),
    getTranscriptRowKey({ speaker: 'user', text: 'same', timestamp: 1 }, 1),
  );
});
