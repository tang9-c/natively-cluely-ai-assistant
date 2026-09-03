// electron/services/research/types.ts
export {
  COMPANY_RESEARCH_DIMENSION_KEYS,
  DOSSIER_SCHEMA_VERSION,
  isCompanyDossier,
} from '../../../shared/companyResearch';
export type {
  CompanyDossier,
  CompanyResearchDimensionKey,
  ConfidenceLevel,
  DossierSource,
  ProfileResearchCompanyResponse,
  ResearchBullet,
  ResearchDimension,
  ResearchErrorCode,
  ResearchSource,
} from '../../../shared/companyResearch';

export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type ResearchStage =
  | 'cache-check' | 'searching' | 'synthesizing' | 'done' | 'error';

export interface ResearchProgress {
  stage: ResearchStage;
  message: string;
}
