import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();

test('transcript list uses dynamic virtualization with bounded overscan', () => {
  const listPath = path.join(root, 'src/components/meeting/TranscriptVirtualList.tsx');
  const list = fs.existsSync(listPath) ? fs.readFileSync(listPath, 'utf8') : '';

  assert.match(list, /useVirtualizer/);
  assert.match(list, /measureElement/);
  assert.match(list, /getItemKey/);
  assert.match(list, /overscan:\s*8/);
  assert.match(list, /data-transcript-total-count/);
  assert.match(list, /data-transcript-rendered-count/);
});

test('transcript row is memoized and remains selectable', () => {
  const rowPath = path.join(root, 'src/components/meeting/TranscriptRow.tsx');
  const row = fs.existsSync(rowPath) ? fs.readFileSync(rowPath, 'utf8') : '';

  assert.match(row, /React\.memo/);
  assert.match(row, /select-text/);
  assert.match(row, /resolveEffectiveSpeaker/);
});
