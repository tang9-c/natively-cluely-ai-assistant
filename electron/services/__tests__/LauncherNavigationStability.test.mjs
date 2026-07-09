import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('launcher route transitions do not wait on an empty interstitial frame', () => {
  const source = read('src/components/Launcher.tsx');
  const start = source.indexOf('<div className="relative flex-1 flex flex-col overflow-hidden">');
  const end = source.indexOf('{/* Notification Toast', start);
  assert.ok(start >= 0 && end > start, 'launcher route transition block should exist');

  const routeBlock = source.slice(start, end);
  const firstAnimatePresence = routeBlock.match(/<AnimatePresence[^>]*>/)?.[0] ?? '';
  assert.equal(firstAnimatePresence, '<AnimatePresence initial={false}>');
  assert.doesNotMatch(firstAnimatePresence, /mode=["']wait["']/);
});

test('app suspense fallback has accessible content instead of an empty dark frame', () => {
  const source = read('src/App.tsx');
  const start = source.indexOf('const AppFallback = (');
  const end = source.indexOf('const SettingsPopup', start);
  assert.ok(start >= 0 && end > start, 'AppFallback block should exist');

  const block = source.slice(start, end);
  assert.match(block, /role="status"/);
  assert.match(block, /aria-label="正在加载 CueUp"/);
  assert.match(block, /正在加载 CueUp\.\.\./);
});
