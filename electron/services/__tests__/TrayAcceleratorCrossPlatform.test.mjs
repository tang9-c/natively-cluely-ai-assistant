import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('main uses shared platform accelerator helpers', () => {
  const main = read('electron/main.ts');

  assert.match(main, /formatAcceleratorForPlatform/);
  assert.match(main, /quitAcceleratorForPlatform/);
  assert.doesNotMatch(main, /accelerator: 'Command\+Q'/);
});

test('cropper window is not preloaded during AppState initialization', () => {
  const main = read('electron/main.ts');
  const preloadCalls = [...main.matchAll(/this\.cropperWindowHelper\.preload\(\);/g)];

  assert.equal(preloadCalls.length, 0, 'cropper window should be created on first use');
});

test('accelerator helper maps CommandOrControl by platform', () => {
  const helper = read('electron/utils/platformAccelerators.ts');

  assert.match(helper, /platform === 'darwin'/);
  assert.match(helper, /'Cmd'/);
  assert.match(helper, /'Ctrl'/);
  assert.match(helper, /Command\+Q/);
  assert.match(helper, /Ctrl\+Q/);
});
