// tests/e2e/launcher-ad-carousel.spec.ts
//
// Task 5: mount <LauncherAdCarousel /> in the Launcher hero section and
// verify the carousel is usable without blocking primary actions, that
// hover pauses rotation and dot clicks switch ads without opening links,
// and that remote image 404s fall back to the built-in ad.

import { expect, test } from './fixtures';

test('launcher shows a usable ad carousel without blocking primary actions', async ({ page }) => {
  const carousel = page.getByTestId('launcher-ad-carousel');
  await expect(carousel).toBeVisible();
  const img = carousel.getByRole('img').first();
  await expect(img).toHaveAttribute('alt', /CueUp|广告/);
  // C1 防御：实际渲染的 <img> 必须能加载到像素（naturalWidth > 0）。
  // 防止 cueup:// 协议或远端失效时退回一个 broken image。
  await expect(img).toHaveJSProperty('naturalWidth', expect.any(Number));
  await expect(img).not.toHaveJSProperty('naturalWidth', 0);
  await expect(page.getByRole('button', { name: /启动会议|显示会议界面/ })).toBeVisible();
});

test('hover pauses ad rotation and dot click switches without opening link', async ({ page }) => {
  const carousel = page.getByTestId('launcher-ad-carousel');
  await expect(carousel).toBeVisible();

  // 多张广告时显示圆点导航
  const dots = carousel.getByRole('button', { name: /显示第 \d+ 张广告/ });
  const dotCount = await dots.count();
  test.skip(dotCount < 2, '需要至少 2 张广告才能验证轮播与圆点切换');

  const firstAlt = await carousel.getByRole('img').first().getAttribute('alt');

  // 悬停超过 6 秒，索引不应改变
  await carousel.hover();
  await page.waitForTimeout(7_000);
  const pausedAlt = await carousel.getByRole('img').first().getAttribute('alt');
  expect(pausedAlt).toBe(firstAlt);

  // 点击第二个圆点：切换广告，但不应打开任何链接（page.url 不变）
  const urlBeforeClick = page.url();
  await dots.nth(1).click();
  const switchedAlt = await carousel.getByRole('img').first().getAttribute('alt');
  expect(switchedAlt).not.toBe(firstAlt);
  expect(page.url()).toBe(urlBeforeClick);

  // 移出后恢复轮播：再等 7 秒应切换到下一张
  await page.mouse.move(0, 0);
  await page.waitForTimeout(7_000);
  const resumedAlt = await carousel.getByRole('img').first().getAttribute('alt');
  expect(resumedAlt).not.toBe(switchedAlt);
});

test('falls back to builtin ad when remote image fails to load', async ({ page }) => {
  const carousel = page.getByTestId('launcher-ad-carousel');

  // 拦截所有远程广告图片请求，强制 404
  await page.route('**/*.{png,webp,jpg,jpeg,gif}', (route) => route.fulfill({ status: 404 }));

  // 重新挂载让轮播重新拉取
  await page.reload();
  await expect(carousel).toBeVisible();

  // builtin fallback 的 alt 应为 CueUp 品牌描述
  await expect(carousel.getByRole('img').first()).toHaveAttribute('alt', /CueUp|广告/);
  // 不应有外部链接可点击
  expect(await carousel.getByRole('button', { name: /显示第/ }).count()).toBe(0);
});
