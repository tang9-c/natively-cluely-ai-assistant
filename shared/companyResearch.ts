export const DOSSIER_SCHEMA_VERSION = '1.0' as const;

export const COMPANY_RESEARCH_DIMENSION_KEYS = [
  'financials',
  'business',
  'strategy',
  'people',
  'infrastructure',
  'procurement',
] as const;

export type CompanyResearchDimensionKey = typeof COMPANY_RESEARCH_DIMENSION_KEYS[number];
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type DossierSource = 'tavily' | 'llm-fallback';

export interface ResearchBullet {
  text: string;
  citation?: number;
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
  snippet: string;
}

export interface CompanyDossier {
  schemaVersion: typeof DOSSIER_SCHEMA_VERSION;
  companyName: string;
  generatedAt: string;
  expiresAt: string;
  source: DossierSource;
  financials: ResearchDimension;
  business: ResearchDimension;
  strategy: ResearchDimension;
  people: ResearchDimension;
  infrastructure: ResearchDimension;
  procurement: ResearchDimension;
  sources: ResearchSource[];
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

export function isCompanyDossier(value: unknown): value is CompanyDossier {
  if (!value || typeof value !== 'object') return false;
  const dossier = value as Record<string, unknown>;
  if (
    dossier.schemaVersion !== DOSSIER_SCHEMA_VERSION
    || typeof dossier.companyName !== 'string'
    || typeof dossier.generatedAt !== 'string'
    || typeof dossier.expiresAt !== 'string'
    || !Array.isArray(dossier.sources)
  ) return false;

  return COMPANY_RESEARCH_DIMENSION_KEYS.every((key) => {
    const dimension = dossier[key];
    if (!dimension || typeof dimension !== 'object') return false;
    const record = dimension as Record<string, unknown>;
    return typeof record.summary === 'string'
      && Array.isArray(record.details)
      && ['high', 'medium', 'low'].includes(String(record.confidence));
  });
}
