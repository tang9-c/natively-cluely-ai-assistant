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
  build(companyName: string, sources: Array<{ title: string; url: string; content: string }>): Promise<CompanyDossier>;
}

interface EngineOpts {
  cache: CacheAdapter;
  search: SearchAdapter;
  builder: BuilderAdapter;
}

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
    const dossier = await this.opts.builder.build(trimmed, sources);

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
