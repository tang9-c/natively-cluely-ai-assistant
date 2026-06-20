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

import { useCallback, useEffect, useRef, useState } from 'react';

export type ResearchStage = 'idle' | 'loading' | 'success' | 'error';
export type ResearchProgressStage = 'cache-check' | 'searching' | 'synthesizing' | null;

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
  progressStage: ResearchProgressStage;
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
  const [progressStage, setProgressStage] = useState<ResearchProgressStage>(null);
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [cached, setCached] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [quotaExhausted, setQuotaExhausted] = useState(false);
  const requestIdRef = useRef<string | null>(null);

  // Subscribe to real-time progress events from the main process.
  // The requestId filter prevents cross-talk when the user triggers
  // multiple research calls in quick succession.
  useEffect(() => {
    const unsubscribe = window.electronAPI.onResearchProgressChanged((data) => {
      if (data.requestId && data.requestId !== requestIdRef.current) {
        return; // stale progress from a previous request
      }
      if (
        data.stage === 'cache-check' ||
        data.stage === 'searching' ||
        data.stage === 'synthesizing'
      ) {
        setProgressStage(data.stage);
      }
    });
    return unsubscribe;
  }, []);

  const research = useCallback(async (name: string, opts?: { forceRefresh?: boolean }) => {
    const requestId = Math.random().toString(36).slice(2);
    requestIdRef.current = requestId;

    setStage('loading');
    setProgressStage('cache-check');
    setError(null);
    setErrorCode(null);
    setQuotaExhausted(false);
    try {
      const res: ResearchResponse = await window.electronAPI.profileResearchCompany(name, {
        ...opts,
        requestId,
      });
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
    } finally {
      // Ignore any late progress events after completion or error.
      requestIdRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current = null;
    setStage('idle');
    setProgressStage(null);
    setDossier(null);
    setCached(false);
    setError(null);
    setErrorCode(null);
    setQuotaExhausted(false);
  }, []);

  return { stage, progressStage, dossier, cached, error, errorCode, quotaExhausted, research, reset };
}
