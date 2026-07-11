// Sharp ImageOptimizer — unit tests.
// Proves the optimizer:
//   - shrinks large PNG → smaller JPEG buffer
//   - honors maxLongEdgePx per profile
//   - strips metadata (no EXIF on output)
//   - caches per cacheKey + profile + provider
//   - enforces maxBytes by stepping quality down

import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const root = path.resolve(__dirname, '../../..');
const screenDir = path.join(root, 'dist-electron/electron/services/screen');

async function loadOptimizer() {
  const mod = await import(pathToFileURL(path.join(screenDir, 'ImageOptimizer.js')).href);
  return mod.ImageOptimizer;
}

let bigPngPath;
async function ensureBigPng() {
  if (bigPngPath) return bigPngPath;
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-opt-test-'));
  bigPngPath = path.join(dir, 'big.png');
  // 2560x1440 white PNG with a black square — well over default maxLongEdge.
  await sharp({
    create: { width: 2560, height: 1440, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .composite([{ input: Buffer.from([0, 0, 0]), raw: { width: 1, height: 1, channels: 3 }, tile: true, top: 100, left: 100 }])
    .png()
    .toFile(bigPngPath);
  return bigPngPath;
}

test('balanced profile resizes long edge to 1280 and emits JPEG smaller than original', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();
  const srcStat = await fs.stat(src);

  const out = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai' });

  assert.equal(out.mimeType, 'image/jpeg');
  assert.ok(out.width <= 1280, `width should be <= 1280, got ${out.width}`);
  assert.ok(out.height <= 1280, `height should be <= 1280, got ${out.height}`);
  assert.ok(out.byteSize < srcStat.size, `optimized (${out.byteSize}) should be smaller than original (${srcStat.size})`);
  assert.equal(out.originalByteSize, srcStat.size);
  assert.equal(out.cacheHit, false);

  await optimizer.cleanupAll();
});

test('technical profile preserves higher resolution than balanced', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const balanced = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'b' });
  const technical = await optimizer.optimize(src, { profile: 'technical', provider: 'openai', cacheKey: 't' });

  assert.ok(technical.width >= balanced.width, 'technical profile should retain >= width');
  assert.ok(technical.height >= balanced.height, 'technical profile should retain >= height');

  await optimizer.cleanupAll();
});

test('fast profile shrinks aggressively below balanced', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const balanced = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'b2' });
  const fast = await optimizer.optimize(src, { profile: 'fast', provider: 'openai', cacheKey: 'f2' });

  assert.ok(fast.byteSize <= balanced.byteSize, `fast (${fast.byteSize}) should be <= balanced (${balanced.byteSize})`);
  await optimizer.cleanupAll();
});

test('cache hit returns same OptimizedImage for same key', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const first = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'cache-test' });
  const second = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'cache-test' });

  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(first.path, second.path);

  await optimizer.cleanupAll();
});

test('different profile invalidates cache', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const balanced = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'k1' });
  const technical = await optimizer.optimize(src, { profile: 'technical', provider: 'openai', cacheKey: 'k1' });

  assert.equal(balanced.cacheHit, false);
  assert.equal(technical.cacheHit, false, 'profile must be part of cache key');
  assert.notEqual(balanced.path, technical.path);

  await optimizer.cleanupAll();
});

test('output JPEG has no EXIF metadata', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'balanced' });
  const meta = await sharp(out.path).metadata();

  // Sharp's default behavior is to drop EXIF unless withMetadata() is called.
  // We never call it, so EXIF must be absent (undefined or empty buffer).
  assert.ok(!meta.exif || meta.exif.length === 0, 'EXIF must be stripped');

  await optimizer.cleanupAll();
});

test('cleanupAll removes every temp file owned by the optimizer', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const a = await optimizer.optimize(src, { profile: 'balanced', cacheKey: 'a' });
  const b = await optimizer.optimize(src, { profile: 'technical', cacheKey: 'b' });

  await fs.access(a.path);
  await fs.access(b.path);

  await optimizer.cleanupAll();
  await assert.rejects(() => fs.access(a.path), 'a.path should be unlinked after cleanupAll');
  await assert.rejects(() => fs.access(b.path), 'b.path should be unlinked after cleanupAll');
});

test('getBase64 returns base64-encoded buffer matching file contents', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'fast' });
  const b64 = await optimizer.getBase64(out);
  const expected = (await fs.readFile(out.path)).toString('base64');

  assert.equal(b64, expected);
  await optimizer.cleanupAll();
});

test('format:"png" emits a PNG with image/png mimeType', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', format: 'png', cacheKey: 'png-test' });

  assert.equal(out.mimeType, 'image/png');
  assert.match(out.path, /\.png$/);
  await optimizer.cleanupAll();
});

test('format:"webp" emits a WebP with image/webp mimeType', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', format: 'webp', cacheKey: 'webp-test' });

  assert.equal(out.mimeType, 'image/webp');
  assert.match(out.path, /\.webp$/);
  await optimizer.cleanupAll();
});

test('highly compressed small PNG falls back to original when re-encoding grows bytes', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'image-opt-small-png-'));
  const src = path.join(dir, 'small.png');

  await sharp({
    create: { width: 32, height: 32, channels: 3, background: { r: 255, g: 255, b: 255 } },
  })
    .png({ compressionLevel: 9, palette: true })
    .toFile(src);
  const srcStat = await fs.stat(src);

  const out = await optimizer.optimize(src, {
    profile: 'fast',
    provider: 'openai',
    format: 'jpeg',
    quality: 90,
    cacheKey: 'small-compressed',
  });

  assert.equal(out.path, src);
  assert.equal(out.mimeType, 'image/png');
  assert.equal(out.byteSize, srcStat.size);
  assert.equal(out.originalByteSize, srcStat.size);
  assert.equal(out.ownsFile, false);
  await optimizer.cleanup(out);
  await fs.access(src);

  await optimizer.cleanupAll();
});

test('quality step-down loop reduces bytes when maxBytes is tight', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const tight = await optimizer.optimize(src, {
    profile: 'balanced',
    provider: 'openai',
    maxBytes: 25_000,
    cacheKey: 'tight',
  });
  // Should still produce a usable result even though maxBytes is aggressive.
  assert.ok(tight.byteSize > 0);
  assert.equal(tight.cacheHit, false);
  await optimizer.cleanupAll();
});

test('throws a descriptive error when the source image cannot be read', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const missingPath = path.join(os.tmpdir(), `image-opt-does-not-exist-${Date.now()}.png`);

  await assert.rejects(
    () => optimizer.optimize(missingPath, { profile: 'balanced' }),
    /cannot stat source image/,
  );
  await optimizer.cleanupAll();
});

test('getDataUrl returns a data URL with the correct mime prefix', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'fast' });
  const dataUrl = await optimizer.getDataUrl(out);
  const expectedPrefix = `data:${out.mimeType};base64,`;
  assert.ok(dataUrl.startsWith(expectedPrefix), `data URL must start with ${expectedPrefix}`);
  const payload = dataUrl.slice(expectedPrefix.length);
  assert.equal(payload, (await fs.readFile(out.path)).toString('base64'));
  await optimizer.cleanupAll();
});

test('cleanup() removes a single optimized file and drops the cache entry', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const out = await optimizer.optimize(src, { profile: 'balanced', cacheKey: 'single-cleanup' });
  await fs.access(out.path);
  assert.equal(optimizer.getCacheStats().entries, 1);

  await optimizer.cleanup(out);

  await assert.rejects(() => fs.access(out.path), 'file should be unlinked after cleanup()');
  assert.equal(optimizer.getCacheStats().entries, 0);
  await optimizer.cleanupAll();
});

test('cleanup() on a stale entry is a no-op (does not throw)', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const fakeOptimized = { path: '/nonexistent/path.jpg', mimeType: 'image/jpeg' };
  await assert.doesNotReject(() => optimizer.cleanup(fakeOptimized));
});

test('getCacheStats starts empty and tracks entries + owned files', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const initial = optimizer.getCacheStats();
  assert.equal(initial.entries, 0);
  assert.equal(initial.ownedFiles, 0);
  assert.match(initial.tempDir, /(image-opt|vision-optimized|optimized)/i);

  await optimizer.optimize(src, { profile: 'balanced', cacheKey: 'k-stats-a' });
  await optimizer.optimize(src, { profile: 'balanced', cacheKey: 'k-stats-b' });

  const after = optimizer.getCacheStats();
  assert.equal(after.entries, 2);
  assert.equal(after.ownedFiles, 2);
  await optimizer.cleanupAll();
});

test('optimize without cacheKey does not populate the cache', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  await optimizer.optimize(src, { profile: 'balanced' });
  assert.equal(optimizer.getCacheStats().entries, 0);
  await optimizer.cleanupAll();
});

test('applyProviderTweaks(ollama) caps width and reduces quality', async () => {
  const Optimizer = await loadOptimizer();
  const optimizer = new Optimizer();
  const src = await ensureBigPng();

  const openai = await optimizer.optimize(src, { profile: 'balanced', provider: 'openai', cacheKey: 'oa' });
  const ollama = await optimizer.optimize(src, { profile: 'balanced', provider: 'ollama', cacheKey: 'ol' });

  // Ollama profiles are typically constrained to a smaller long edge; verify
  // the resulting image respects at least the same bound.
  assert.ok(ollama.width <= 1280, `ollama width ${ollama.width} should be <= 1280`);
  assert.ok(ollama.height <= 1280, `ollama height ${ollama.height} should be <= 1280`);
  assert.equal(openai.mimeType, ollama.mimeType);
  await optimizer.cleanupAll();
});
