import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { redactForLog } from '../../utils/redactForLog';
import {
  AD_CACHE_TTL_MS,
  AD_FETCH_TIMEOUT_MS,
  DEFAULT_LAUNCHER_AD,
  type LauncherAd,
} from './RemoteAdTypes';
import { isHttpsUrl, validateRemoteAdConfig } from './RemoteAdValidator';

interface CachedAds { fetchedAt: string; config: unknown }
interface RemoteAdDependencies {
  configUrl: string;
  now: () => Date;
  readCache: () => CachedAds | null;
  writeCache: (cache: CachedAds) => void;
  fetchJson: (url: string) => Promise<unknown>;
}

const cachePath = () => path.join(app.getPath('userData'), 'launcher-ads.json');

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(AD_FETCH_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > 256 * 1024) throw new Error('response too large');
  const text = await response.text();
  if (Buffer.byteLength(text, 'utf8') > 256 * 1024) throw new Error('response too large');
  return JSON.parse(text);
}

const defaultDependencies = (): RemoteAdDependencies => {
  // I1: CUEUP_LAUNCHER_ADS_URL 必须是 https://，否则视为空配置走缓存 + 内置 fallback，
  // 不允许在网络边界放过 http:// 绕开 HTTPS-only 不变量。
  const rawConfigUrl = process.env.CUEUP_LAUNCHER_ADS_URL?.trim() ?? '';
  const safeConfigUrl = rawConfigUrl && isHttpsUrl(rawConfigUrl) ? rawConfigUrl : '';
  if (rawConfigUrl && !safeConfigUrl) {
    let protocol = 'unknown';
    let hostname = 'unknown';
    try {
      const parsed = new URL(rawConfigUrl);
      protocol = parsed.protocol;
      hostname = parsed.hostname;
    } catch { /* leave defaults */ }
    console.warn('[LauncherAds] Ignoring non-https configUrl',
      redactForLog([{ protocol, hostname }]));
  }
  return {
    configUrl: safeConfigUrl,
    now: () => new Date(),
    readCache: () => {
      try { return JSON.parse(fs.readFileSync(cachePath(), 'utf8')) as CachedAds; }
      catch { return null; }
    },
    writeCache: (cache) => {
      try { fs.writeFileSync(cachePath(), JSON.stringify(cache), 'utf8'); }
      catch (error) { console.warn('[LauncherAds] Cache write failed', redactForLog([error])); }
    },
    fetchJson,
  };
};

export class RemoteAdService {
  private static instance: RemoteAdService | null = null;
  private readonly deps: RemoteAdDependencies;

  static getInstance(): RemoteAdService {
    return this.instance ??= new RemoteAdService();
  }

  static isAllowedTargetUrl(url: string): boolean {
    try { return new URL(url).protocol === 'https:'; }
    catch { return false; }
  }

  constructor(deps: RemoteAdDependencies = defaultDependencies()) {
    this.deps = deps;
  }

  async getAds(): Promise<LauncherAd[]> {
    const now = this.deps.now();
    const cached = this.deps.readCache();
    const cachedAds = cached ? validateRemoteAdConfig(cached.config, now) : [];
    const cacheFresh = cached && now.getTime() - Date.parse(cached.fetchedAt) < AD_CACHE_TTL_MS;

    // TTL 内：直接服务缓存。即便缓存校验后为空也返回内置，避免 TTL 内重复请求
    if (cacheFresh) {
      return cachedAds.length ? cachedAds : [DEFAULT_LAUNCHER_AD];
    }

    if (this.deps.configUrl) {
      try {
        const config = await this.deps.fetchJson(this.deps.configUrl);
        const ads = validateRemoteAdConfig(config, now);
        // 始终缓存原始远端响应（即便过滤后为空），TTL 内不再重复请求
        this.deps.writeCache({ fetchedAt: now.toISOString(), config });
        if (ads.length) return ads;
      } catch (error) {
        console.warn('[LauncherAds] Remote config unavailable', redactForLog([error]));
      }
    }

    // 远端失败或为空：使用已校验的 stale 缓存，再退到内置
    return cachedAds.length ? cachedAds : [DEFAULT_LAUNCHER_AD];
  }
}
