import { sanitizeSenseVoiceTerms } from './termCorrection';
import type { SenseVoiceTermEntry } from './types';

export const DEFAULT_SENSEVOICE_TERM_CORRECTIONS: SenseVoiceTermEntry[] = sanitizeSenseVoiceTerms([
  {
    id: 'industrial-mes-supplier',
    canonical: 'MES供应商',
    variants: ['麦供应商', '卖供应商'],
    enabled: true,
  },
  {
    id: 'industrial-plm',
    canonical: 'PLM',
    variants: ['皮诶勒姆', '听阿勒姆', 'TA乐姆', 'P L M'],
    enabled: true,
  },
  {
    id: 'industrial-qms',
    canonical: 'QMS',
    variants: ['Q M S'],
    enabled: true,
  },
  {
    id: 'industrial-erp',
    canonical: 'ERP',
    variants: ['E R P'],
    enabled: true,
  },
  {
    id: 'industrial-creo',
    canonical: 'Creo',
    variants: ['克里奥'],
    enabled: true,
  },
  {
    id: 'industrial-windchill',
    canonical: 'Windchill',
    variants: ['温彻'],
    enabled: true,
  },
  {
    id: 'industrial-bom',
    canonical: 'BOM',
    variants: ['B O M'],
    enabled: true,
  },
  {
    id: 'industrial-eco',
    canonical: 'ECO',
    variants: ['E C O'],
    enabled: true,
  },
  {
    id: 'industrial-ecr',
    canonical: 'ECR',
    variants: ['E C R'],
    enabled: true,
  },
  {
    id: 'industrial-fmea',
    canonical: 'FMEA',
    variants: ['F M E A'],
    enabled: true,
  },
]);

export function mergeSenseVoiceTermCorrections(userTerms: unknown): SenseVoiceTermEntry[] {
  const mergedByCanonical = new Map<string, SenseVoiceTermEntry>();

  for (const term of DEFAULT_SENSEVOICE_TERM_CORRECTIONS) {
    mergedByCanonical.set(term.canonical.toLowerCase(), term);
  }

  for (const term of sanitizeSenseVoiceTerms(userTerms)) {
    mergedByCanonical.set(term.canonical.toLowerCase(), term);
  }

  return [...mergedByCanonical.values()];
}
