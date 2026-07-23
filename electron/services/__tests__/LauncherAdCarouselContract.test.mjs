import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = () => fs.readFileSync(path.join(root, 'src/components/launcher/LauncherAdCarousel.tsx'), 'utf8');

test('carousel owns timing, pause, fallback, reduced motion, keyboard, and builtin behavior', () => {
  const code = source();
  assert.match(code, /const ROTATION_INTERVAL_MS = 6_000/);
  assert.match(code, /onMouseEnter=.*setPaused\(true\)/s);
  assert.match(code, /onMouseLeave=.*setPaused\(false\)/s);
  assert.match(code, /defaultLauncherAd/);
  assert.match(code, /useReducedMotion/);
  // reduceMotion 必须真的影响动画时长，不只是被引用
  assert.match(code, /duration:\s*reduceMotion\s*\?\s*0\s*:\s*0\.35/);
  assert.match(code, /event\.key === 'Enter'.*event\.key === ' '/s);
  assert.match(code, /clearInterval/);
  // builtin fallback 不应进入失败集合
  assert.match(code, /if\s*\(\s*!\s*activeAd\.builtin\s*\)/);
  // 图片预加载
  assert.match(code, /new\s+Image\(\)/);
  // safeIndex 必须在过滤后归一化
  assert.match(code, /Math\.min\(activeIndex/);
  // C1: must strip builtin ads from the main process payload before display so
  // the cueup:// imageUrl never leaks into <img src>
  assert.match(code, /\.filter\(\s*\(ad\)\s*=>\s*!\s*ad\.builtin/);
});