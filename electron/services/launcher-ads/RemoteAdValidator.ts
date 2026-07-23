import type { LauncherAd } from './RemoteAdTypes';
import { MAX_LAUNCHER_ADS } from './RemoteAdTypes';

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

function parseOptionalDate(value: unknown): string | undefined | null {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) return null;
  return value;
}

export function validateRemoteAdConfig(input: unknown, now = new Date()): LauncherAd[] {
  if (!input || typeof input !== 'object') return [];
  const config = input as { version?: unknown; ads?: unknown };
  if (config.version !== 1 || !Array.isArray(config.ads)) return [];

  const seen = new Set<string>();
  const valid: Array<{ ad: LauncherAd; index: number }> = [];

  config.ads.forEach((candidate, index) => {
    if (!candidate || typeof candidate !== 'object') return;
    const raw = candidate as Record<string, unknown>;
    const startsAt = parseOptionalDate(raw.startsAt);
    const endsAt = parseOptionalDate(raw.endsAt);
    if (
      typeof raw.id !== 'string' || !raw.id.trim() || seen.has(raw.id) ||
      typeof raw.alt !== 'string' || !raw.alt.trim() ||
      !isHttpsUrl(raw.imageUrl) ||
      (raw.targetUrl !== undefined && !isHttpsUrl(raw.targetUrl)) ||
      startsAt === null || endsAt === null
    ) return;

    const nowMs = now.getTime();
    if (startsAt && Date.parse(startsAt) > nowMs) return;
    if (endsAt && Date.parse(endsAt) <= nowMs) return;

    seen.add(raw.id);
    valid.push({
      index,
      ad: {
        id: raw.id,
        imageUrl: raw.imageUrl,
        targetUrl: raw.targetUrl as string | undefined,
        alt: raw.alt,
        startsAt,
        endsAt,
        priority: typeof raw.priority === 'number' && Number.isFinite(raw.priority) ? raw.priority : 0,
      },
    });
  });

  return valid
    .sort((a, b) => b.ad.priority - a.ad.priority || a.index - b.index)
    .slice(0, MAX_LAUNCHER_ADS)
    .map(({ ad }) => ad);
}