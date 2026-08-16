import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const source = fs.readFileSync(path.join(root, 'electron/main.ts'), 'utf8');
const start = source.indexOf('app.on("before-quit"');
const end = source.indexOf('// app.dock?.hide()', start);
const shutdownSource = source.slice(start, end);

test('before-quit releases shared screenshot, image, and RAG resources', () => {
  assert.ok(start >= 0 && end > start, 'before-quit handler should be isolated');
  assert.match(shutdownSource, /appState\.clearQueues\(\)/);
  assert.match(shutdownSource, /getImageOptimizer\(\)\.cleanupAll\(\)/);
  assert.match(shutdownSource, /appState\.getRAGManager\(\)/);
  assert.match(shutdownSource, /ragManager\.dispose\(\)/);
  assert.match(shutdownSource, /event\.preventDefault\(\)/);
  assert.match(shutdownSource, /if \(quitCleanupComplete\) return/);
  assert.match(shutdownSource, /await Promise\.allSettled\(cleanupTasks\)/);
  assert.ok(
    shutdownSource.indexOf('quitCleanupComplete = true')
      < shutdownSource.lastIndexOf('app.quit()'),
    'second app.quit should happen only after cleanup is marked complete',
  );
  assert.doesNotMatch(shutdownSource, /new ScreenshotHelper\(\)/);
});
