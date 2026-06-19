// src/hooks/useResearch.ts
//
// React hook that drives the company research pipeline through the
// IPC handler added in Phase 1. Owns the local UI state machine for
// ResearchPanel (Task 23): idle → loading → success | error.
//
// The hook is the single point of contact between ResearchPanel and
// `window.electronAPI.profileResearchCompany`. Components never call
// the IPC channel directly so we keep all error / quota mapping in
// one place.

import { useCallback, useState } from 'react';

export type ResearchStage = 'idle' | 'loading' | 'success' | 'error';

interface Dossier {
  schemaVersion: '1.0';
  companyName: string;
  generatedAt: string;
  expiresAt: string;
  source: 'tavily' | 'llm-fallback';
  financials: any;
  business: any;
  strategy: any;
  people: any;
  infrastructure: any;
  procurement: any;
  sources: Array<{ index: number; title: string; url: string; snippet: string }>;
}

interface ResearchResponse {
  success: boolean;
  dossier?: Dossier;
  cached?: boolean;
  searchQuotaExhausted?: boolean;
  error?: string;
  errorCode?: string;
}

export interface UseResearchReturn {
  stage: ResearchStage;
  dossier: Dossier | null;
  cached: boolean;
  error: string | null;
  errorCode: string | null;
  quotaExhausted: boolean;
  research(name: string, opts?: { forceRefresh?: boolean }): Promise<void>;
  reset(): void;
}

export function useResearch(): UseResearchReturn {
  const [stage, setStage] = useState<ResearchStage>('idle');
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);

  const research = useCallback(async (name: string, opts?: { forceRefresh?: boolean }) => {
    setStage('loading');
    setError(null);
    setErrorCode(null);
    setQuotaExhausted(false);
    try {
      const res: ResearchResponse = await window.electronAPI.profileResearchCompany(name, opts);
      if (res.success && res.dossier) {
        setDossier(res.dossier);
        setCached(!!res.cached);
        setStage('success');
      } else {
        setError(res.error ?? 'unknown error');
        setErrorCode(res.errorCode ?? null);
        setQuotaExhausted(!!res.searchQuotaExhausted);
        setStage('error');
      }
    } catch (err: any) {
      setError(err?.message ?? 'IPC failed');
      setStage('error');
    }
  }, []);

  const reset = useCallback(() => {
    setStage('idle');
    setDossier(null);
    setCached(false);
    setError(null);
    setErrorCode(null);
    setQuotaExhausted(false);
  }, []);

  return { stage, dossier, cached, error, errorCode, quotaExhausted, research, reset };
}
