// electron/services/research/CompanyResearchEngine.ts
import type {
  CompanyDossier, ProfileResearchCompanyResponse, ResearchProgress,
} from './types';
import type { TavilySearchProvider } from './TavilySearchProvider';
import type { CompanyResearchCache } from './CompanyResearchCache';
import type { ResearchDossierBuilder } from './ResearchDossierBuilder';

interface CacheAdapter {
  get(companyName: string): Promise<{ dossier: CompanyDossier; isExpired: () => boolean } | null>;
  put(companyName: string, dossier: CompanyDossier): Promise<void>;
  clearAll?(): Promise<number>;
}

interface SearchAdapter {
  search(queries: string[]): Promise<Array<{ title: string; url: string; content: string }>>;
}

interface BuilderAdapter {
  build(
    companyName: string,
    sources: Array<{ title: string; url: string; content: string }>,
    opts?: { onAttempt?: (attempt: number) => void },
  ): Promise<CompanyDossier>;
}

interface EngineOpts {
  cache: CacheAdapter;
  search: SearchAdapter;
  builder: BuilderAdapter;
  /**
   * Outer timeout (ms) for the synthesis stage. Defaults to 60_000.
   * Bounds the user-visible stall when the underlying LLM call hangs.
   */
  synthesisTimeoutMs?: number;
}

/** Default synthesis timeout — prevents indefinite spinner during LLM hang.
 *  Raised 60_000 → 120_000 (debug session 2026-06-22): the builder retries
 *  up to twice on schema-mismatch, each attempt being a 45s LLM call
 *  (ResearchDossierBuilder.perProviderTimeoutMs). 60s could not accommodate
 *  two slow attempts × 45s + parse overhead, so the second attempt was
 *  aborted mid-flight and the user saw "LLM_TIMEOUT". 120s gives the retry
 *  loop headroom while still bounding a true hang.
 */
export const DEFAULT_SYNTHESIS_TIMEOUT_MS = 120_000;

interface ResearchOpts {
  forceRefresh?: boolean;
  onProgress?: (p: ResearchProgress) => void;
}

export class CompanyResearchEngine {
  constructor(private readonly opts: EngineOpts) {}

  async research(companyName: string, opts: ResearchOpts = {}): Promise<ProfileResearchCompanyResponse> {
    const trimmed = (companyName ?? '').trim();
    if (!trimmed || trimmed.length > 100) {
      return { success: false, errorCode: 'INVALID_INPUT',
        error: '请输入有效的公司名（1-100 字符）' };
    }

    const progress = (p: ResearchProgress) => opts.onProgress?.(p);

    progress({ stage: 'cache-check', message: '正在检查缓存...' });
    if (!opts.forceRefresh) {
      const cached = await this.opts.cache.get(trimmed);
      if (cached && !cached.isExpired()) {
        progress({ stage: 'done', message: '缓存命中' });
        return { success: true, dossier: cached.dossier, cached: true };
      }
    }

    progress({ stage: 'searching', message: '正在搜索...' });
    const queries = this.buildQueries(trimmed);
    let sources: Array<{ title: string; url: string; content: string }> = [];
    try {
      sources = await this.opts.search.search(queries);
    } catch (err) {
      // Use err.name duck-typing instead of `instanceof` because esbuild's
      // bundling produces a separate copy of the TavilyError class inside
      // this module, so cross-module instanceof checks would fail.
      const errName = (err as { name?: string } | null)?.name;
      if (errName === 'TavilyQuotaError') {
        return { success: false, searchQuotaExhausted: true,
          errorCode: 'TAVILY_QUOTA_EXHAUSTED',
          error: 'Tavily 搜索额度已用完，请在 Tavily 控制台升级或等待下月重置' };
      }
      if (errName === 'TavilyAuthError') {
        return { success: false, errorCode: 'TAVILY_INVALID_KEY',
          error: 'Tavily API key 无效，请检查设置' };
      }
      // TavilyNetworkError / unknown → fallback
      sources = [];
    }

    progress({ stage: 'synthesizing', message: '正在综合 AI 报告...' });
    let dossier: CompanyDossier;
    try {
      dossier = await this.withSynthesisTimeout(
        this.opts.builder.build(trimmed, sources, {
          onAttempt: (n) => progress({
            stage: 'synthesizing',
            message: n === 1 ? '正在综合 AI 报告...' : `AI 综合重试中 (${n}/2)...`,
          }),
        }),
        this.opts.synthesisTimeoutMs ?? DEFAULT_SYNTHESIS_TIMEOUT_MS,
      );
    } catch (err) {
      // Map any timeout/non-Error throw to a typed LLM_INVALID_FORMAT so the
      // IPC layer can render a useful message instead of "DB_ERROR".
      const name = (err as { name?: string } | null)?.name;
      const isTimeout = name === 'AbortError' || /timed?\s*out/i.test(String((err as Error)?.message ?? ''));
      const code = isTimeout ? 'LLM_TIMEOUT' : 'LLM_FAILED';
      return {
        success: false,
        errorCode: code,
        error: isTimeout
          ? 'AI 综合超时，请稍后重试或检查 LLM provider 配置'
          : (err as Error)?.message ?? 'AI 综合失败',
      };
    }

    await this.opts.cache.put(trimmed, dossier);
    progress({ stage: 'done', message: '完成' });
    return { success: true, dossier, cached: false };
  }

  async clearCache(): Promise<number> {
    if (this.opts.cache.clearAll) {
      return await this.opts.cache.clearAll();
    }
    return 0;
  }

  /**
   * Race the synthesis promise against an AbortController-driven timeout.
   * On timeout, the AbortError propagates so callers can distinguish it
   * from LLM-content failures and surface a useful message.
   */
  private async withSynthesisTimeout<T>(p: Promise<T>, timeoutMs: number): Promise<T> {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return p;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // We can't pass the AbortSignal into the builder (it doesn't accept one),
      // so we just race the promise against a timeout reject. The builder's
      // internal work is not cancelled — but the caller gets a fast error and
      // can show "synthesis timed out" instead of a frozen spinner.
      return await new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new Error(`Synthesis timed out after ${timeoutMs}ms`));
        if (controller.signal.aborted) {
          onAbort();
          return;
        }
        controller.signal.addEventListener('abort', onAbort, { once: true });
        p.then(
          (v) => { clearTimeout(timer); resolve(v); },
          (e) => { clearTimeout(timer); reject(e); },
        );
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private buildQueries(companyName: string): string[] {
    return [
      `${companyName} revenue employees annual report 2024`,
      `${companyName} products customers target market`,
      `${companyName} expansion strategy hiring 2025`,
      `${companyName} executives leadership team`,
      `${companyName} technology stack infrastructure`,
      `${companyName} procurement suppliers compliance`,
    ];
  }
}
