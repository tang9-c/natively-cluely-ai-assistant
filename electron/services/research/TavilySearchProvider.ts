// electron/services/research/TavilySearchProvider.ts
import { redactForLog } from '../../utils/redactForLog';

export class TavilyError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'TavilyError';
  }
}
export class TavilyQuotaError extends TavilyError {
  constructor(message = 'Tavily quota exhausted') { super(message); this.name = 'TavilyQuotaError'; }
}
export class TavilyAuthError extends TavilyError {
  constructor(message = 'Tavily API key invalid') { super(message); this.name = 'TavilyAuthError'; }
}
export class TavilyNetworkError extends TavilyError {
  constructor(message = 'Tavily network error', cause?: unknown) {
    super(message, cause);
    this.name = 'TavilyNetworkError';
  }
}

export interface TavilySearchOpts {
  apiKey: string;
  fetchImpl?: typeof fetch;     // injected for tests
  timeoutMs?: number;            // default 10_000
  maxResultsPerQuery?: number;   // default 5
}

export interface TavilyRawResult {
  title: string;
  url: string;
  content: string;
}

export class TavilySearchProvider {
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly maxResultsPerQuery: number;

  constructor(opts: TavilySearchOpts) {
    if (!opts.apiKey) throw new TavilyAuthError('apiKey required');
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.maxResultsPerQuery = opts.maxResultsPerQuery ?? 5;
  }

  async search(queries: string[]): Promise<TavilyRawResult[]> {
    if (queries.length === 0) return [];
    const all: TavilyRawResult[] = [];
    for (const q of queries) {
      const results = await this.searchOne(q);
      all.push(...results);
    }
    // de-dupe by URL
    const seen = new Set<string>();
    return all.filter((r) => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
  }

  private async searchOne(query: string): Promise<TavilyRawResult[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: this.apiKey,
          query,
          max_results: this.maxResultsPerQuery,
          include_answer: false,
        }),
        signal: controller.signal,
      });
      if (res.status === 429) throw new TavilyQuotaError();
      if (res.status === 401 || res.status === 403) throw new TavilyAuthError();
      if (!res.ok) throw new TavilyNetworkError(`HTTP ${res.status}`);
      const json: any = await res.json();
      const results = Array.isArray(json?.results) ? json.results : [];
      return results
        .filter((r: any) => isValidUrl(String(r.url ?? '')))
        .map((r: any) => ({
          title: String(r.title ?? ''),
          url: String(r.url ?? ''),
          content: String(r.content ?? '').slice(0, 1000),
        }));
    } catch (err: any) {
      if (err instanceof TavilyError) throw err;
      if (err?.name === 'AbortError') {
        throw new TavilyNetworkError('timeout', err);
      }
      console.warn('[TavilySearchProvider] failed:', redactForLog([err]));
      throw new TavilyNetworkError(err?.message ?? 'unknown', err);
    } finally {
      clearTimeout(timer);
    }
  }
}

function isValidUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
