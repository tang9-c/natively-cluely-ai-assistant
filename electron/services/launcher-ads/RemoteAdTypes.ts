export interface LauncherAd {
  id: string;
  imageUrl: string;
  targetUrl?: string;
  alt: string;
  startsAt?: string;
  endsAt?: string;
  priority: number;
  builtin?: boolean;
}

export interface RemoteAdConfig {
  version: 1;
  ads: unknown[];
}

export const MAX_LAUNCHER_ADS = 10;
export const AD_CACHE_TTL_MS = 60 * 60 * 1000;
export const AD_FETCH_TIMEOUT_MS = 5_000;

export const DEFAULT_LAUNCHER_AD: LauncherAd = {
  id: 'cueup-default',
  imageUrl: 'cueup://launcher-ad/default',
  alt: 'CueUp AI Meeting Assistant',
  priority: 0,
  builtin: true,
};
