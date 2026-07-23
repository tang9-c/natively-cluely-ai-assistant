import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';

import defaultLauncherAd from '@/assets/default-launcher-ad.svg';
import { cn } from '@/lib/utils';
import type { LauncherAd } from '@/types/electron';

const ROTATION_INTERVAL_MS = 6_000;

interface LauncherAdCarouselProps { className?: string }

export function LauncherAdCarousel({ className }: LauncherAdCarouselProps) {
  const reduceMotion = useReducedMotion();
  const [ads, setAds] = useState<LauncherAd[]>([]);
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  // 点击圆点或切换广告时递增，强制 setInterval 重建以重置周期
  const [cycleKey, setCycleKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI.getLauncherAds()
      .then((items) => { if (!cancelled) setAds(items); })
      .catch(() => { if (!cancelled) setAds([]); });
    return () => { cancelled = true; };
  }, []);

  // Renderer 侧的 builtin fallback：使用打包资源，绝不向 <img> 传入远端 URL 形式
  // 的 builtin 标记。主进程返回的 DEFAULT_LAUNCHER_AD.imageUrl 是 'cueup://...' 协议，
  // 这里直接覆盖为本地 SVG 路径
  const defaultAd: LauncherAd = useMemo(() => ({
    id: 'cueup-default-renderer', imageUrl: defaultLauncherAd,
    alt: 'CueUp AI Meeting Assistant', priority: 0, builtin: true,
  }), []);
  // 边界 0：主进程可能返回 builtin = true 的 DEFAULT_LAUNCHER_AD（imageUrl 是
  // 'cueup://...' 协议，<img> 无法渲染）。过滤掉 builtin，只接受真实远端广告；
  // 若过滤后为空则使用本地打包资源的 fallback，绝不让 cueup:// 出现在 <img src> 里。
  const remoteAds = ads.filter((ad) => !ad.builtin && !failedIds.has(ad.id));
  const displayAds = remoteAds.length ? remoteAds : [defaultAd];
  // 边界 1：当过滤导致长度变短时，把索引归一化而不是 mod（避免瞬间跳到末尾）
  const safeIndex = displayAds.length === 0 ? 0 : Math.min(activeIndex, displayAds.length - 1);
  const activeAd = displayAds[safeIndex];

  // 预加载所有非 builtin 广告的图片，避免切换时白屏
  useEffect(() => {
    ads.filter((ad) => !ad.builtin).forEach((ad) => {
      const img = new Image();
      img.src = ad.imageUrl;
    });
  }, [ads]);

  // 边界 2：不要把 safeIndex 放进依赖数组，否则每次自动轮播都重建 setInterval，
  // cleanup 总在下一个 tick 前执行 → 永不切换。使用 cycleKey 让圆点点击能重置周期。
  useEffect(() => {
    if (paused || displayAds.length <= 1) return;
    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % displayAds.length);
    }, ROTATION_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [paused, displayAds.length, cycleKey]);

  const openActiveAd = () => {
    if (activeAd.targetUrl) void window.electronAPI.openAdLink(activeAd.targetUrl);
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if ((event.key === 'Enter' || event.key === ' ') && activeAd.targetUrl) {
      event.preventDefault();
      openActiveAd();
    }
  };

  return (
    <div className={cn('relative h-full overflow-hidden rounded-xl bg-bg-elevated', className)}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <div role={activeAd.targetUrl ? 'button' : undefined} tabIndex={activeAd.targetUrl ? 0 : undefined}
        onClick={activeAd.targetUrl ? openActiveAd : undefined} onKeyDown={onKeyDown}
        className={cn('h-full w-full', activeAd.targetUrl && 'cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/80')}>
        <AnimatePresence mode="sync" initial={false}>
          <motion.img key={activeAd.id} src={activeAd.imageUrl} alt={activeAd.alt}
            className="absolute inset-0 h-full w-full object-cover"
            initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }}
            transition={{ duration: reduceMotion ? 0 : 0.35 }}
            onError={() => {
              // 边界 3：builtin fallback 失败时不要加入失败集合，否则会递归触发空轮播
              if (!activeAd.builtin) {
                setFailedIds((ids) => new Set(ids).add(activeAd.id));
              }
            }} />
        </AnimatePresence>
      </div>
      {displayAds.length > 1 && <div className="absolute inset-x-0 bottom-3 z-10 flex justify-center gap-1.5" aria-label="广告轮播导航">
        {displayAds.map((ad, index) => <button key={ad.id} type="button" aria-label={`显示第 ${index + 1} 张广告`}
          aria-current={index === safeIndex ? 'true' : undefined}
          onClick={(event) => { event.stopPropagation(); setActiveIndex(index); setCycleKey((k) => k + 1); }}
          className={cn('h-1.5 rounded-full bg-white/45 transition-all', index === safeIndex ? 'w-4 bg-white' : 'w-1.5')} />)}
      </div>}
    </div>
  );
}