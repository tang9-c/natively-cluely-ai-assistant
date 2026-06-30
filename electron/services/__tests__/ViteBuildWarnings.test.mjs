import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const read = rel => fs.readFileSync(path.join(repoRoot, rel), 'utf8');

test('Vite build warning prevention keeps STT error mapper statically imported only once', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.doesNotMatch(source, /import\(['"]\.\.\/lib\/sttErrorMapper['"]\)/);
  assert.match(source, /import\s+\{\s*categorizeSttError\s*\}\s+from ['"]\.\.\/lib\/sttErrorMapper['"]/);
});

test('Vite build warning prevention splits large markdown and syntax dependencies', () => {
  const config = read('vite.config.mts');

  assert.match(config, /markdown:/);
  assert.match(config, /'react-markdown'/);
  assert.match(config, /'rehype-katex'/);
  assert.match(config, /syntax:/);
  assert.match(config, /'react-syntax-highlighter'/);
});

test('Vite build warning prevention lazy-loads window-level renderer components', () => {
  const source = read('src/App.tsx');

  assert.doesNotMatch(source, /import NativelyInterface from/);
  assert.doesNotMatch(source, /import SettingsOverlay from/);
  assert.doesNotMatch(source, /import Launcher from/);
  assert.match(source, /React\.lazy\(\(\) => import\(["']\.\/components\/NativelyInterface["']\)\)/);
  assert.match(source, /React\.lazy\(\(\) => import\(["']\.\/components\/SettingsOverlay["']\)\)/);
  assert.match(source, /React\.lazy\(\(\) => import\(["']\.\/components\/Launcher["']\)\)/);
});
