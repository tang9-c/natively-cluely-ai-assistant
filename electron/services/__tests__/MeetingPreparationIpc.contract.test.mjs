import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');
const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
const rendererTypes = fs.readFileSync(path.join(root, 'src/types/electron.d.ts'), 'utf8');

test('meeting preparation IPC is wired through Main, preload and renderer types', () => {
  const channels = [
    'meeting-preparation-save',
    'meeting-preparation-get',
    'meeting-preparation-list',
    'meeting-preparation-delete',
    'meeting-preparation-parse-input',
    'meeting-preparation-prepare-context',
    'meeting-preparation-generate',
    'meeting-preparation-recheck-question',
    'meeting-preparation-apply-mode',
    'meeting-preparation-cancel-operation',
  ];

  for (const channel of channels) {
    assert.match(ipc, new RegExp(`safeHandle\\(\\s*['"]${channel}['"]`));
    assert.match(preload, new RegExp(`ipcRenderer\\.invoke\\(\\s*['"]${channel}['"]`));
  }
  assert.doesNotMatch(ipc, /meeting-preparation-research-/);
  assert.match(rendererTypes, /meetingPreparationSave/);
  assert.match(rendererTypes, /meetingPreparationGenerate/);
});

test('manual question saves are not capped at the AI prediction limit', () => {
  assert.match(ipc, /input\.questions !== undefined && !Array\.isArray\(input\.questions\)/);
  assert.doesNotMatch(ipc, /input\.questions\.length > 3/);
});
