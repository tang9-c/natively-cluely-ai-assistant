// electron/services/research/types.ts
export const DOSSIER_SCHEMA_VERSION = '1.0' as const;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type DossierSource = 'tavily' | 'llm-fallback';

export interface ResearchBullet {
  text: string;
  citation?: number; // 1-based index into ResearchSource[]
}

export interface ResearchDimension {
  summary: string;
  details: ResearchBullet[];
  confidence: ConfidenceLevel;
}

export interface ResearchSource {
  index: number;
  title: string;
  url: string;
  snippet: string; // <=200 chars
}

export interface CompanyDossier {
  schemaVersion: typeof DOSSIER_SCHEMA_VERSION;
  companyName: string;          // display name
  generatedAt: string;          // ISO 8601
  expiresAt: string;            // ISO 8601
  source: DossierSource;
  financials: ResearchDimension;
  business: ResearchDimension;
  strategy: ResearchDimension;
  people: ResearchDimension;
  infrastructure: ResearchDimension;
  procurement: ResearchDimension;
  sources: ResearchSource[];    // empty when source === 'llm-fallback'
}

export type ResearchStage =
  | 'cache-check' | 'searching' | 'synthesizing' | 'done' | 'error';

export interface ResearchProgress {
  stage: ResearchStage;
  message: string;
}

export type ResearchErrorCode =
  | 'INVALID_INPUT'
  | 'TAVILY_KEY_MISSING'
  | 'TAVILY_QUOTA_EXHAUSTED'
  | 'TAVILY_INVALID_KEY'
  | 'TAVILY_NETWORK_ERROR'
  | 'LLM_FAILED'
  | 'LLM_TIMEOUT'
  | 'LLM_INVALID_FORMAT'
  | 'DB_ERROR';

export interface ProfileResearchCompanyResponse {
  success: boolean;
  dossier?: CompanyDossier;
  cached?: boolean;
  searchQuotaExhausted?: boolean;
  error?: string;
  errorCode?: ResearchErrorCode;
}
