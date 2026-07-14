import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

const source = fs.readFileSync('electron/LLMHelper.ts', 'utf8');

test('LLMHelper suppresses known Electron-as-Node test initialization noise without changing control flow', () => {
  assert.match(source, /function isElectronNodeTestRuntime\(\)/);
  assert.match(source, /process\.env\.ELECTRON_RUN_AS_NODE === '1'/);
  assert.match(source, /warnedMissingPrimaryApiKey/);
  assert.match(source, /if \(!isElectronNodeTestRuntime\(\)\) \{\s*console\.warn\('\[LLMHelper\] ModesManager injection failed/);
  assert.doesNotMatch(source, /catch \(_modeErr: any\) \{\s*if \(isElectronNodeTestRuntime\(\)\) \{\s*return/s);
});
