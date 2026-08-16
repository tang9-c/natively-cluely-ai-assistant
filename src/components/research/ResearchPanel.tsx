// src/components/research/ResearchPanel.tsx
//
// Top-level container for the Research feature. Drives the
// useResearch state machine from a single useEffect and renders the
// correct sub-view (input / progress / error / dossier) based on
// the current stage. Mounted from App.tsx once the user opens the
// panel; the close button simply toggles isOpen=false.

import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, RefreshCw } from 'lucide-react';
import { useResearch } from '../../hooks/useResearch';
import { ResearchInput } from './ResearchInput';
import { ResearchProgress } from './ResearchProgress';
import { ResearchDimension } from './ResearchDimension';
import { ResearchErrorBanner } from './ResearchErrorBanner';
import { ResearchFallbackBanner } from './ResearchFallbackBanner';

interface Props {
  isOpen: boolean;
  initialCompanyName?: string;
  onClose: () => void;
}

const DIMENSION_DEFS = [
  { key: 'financials', title: '经营实力', subtitle: 'Financials' },
  { key: 'business', title: '业务版图', subtitle: 'Business' },
  { key: 'strategy', title: '战略动向', subtitle: 'Strategy' },
  { key: 'people', title: '关键人画像', subtitle: 'People' },
  { key: 'infrastructure', title: '技术与资产现状', subtitle: 'Infrastructure' },
  { key: 'procurement', title: '采购合规历史', subtitle: 'Procurement' },
] as const;

export function ResearchPanel({ isOpen, initialCompanyName = '', onClose }: Props) {
  const r = useResearch();

  useEffect(() => {
    if (!isOpen) r.reset();
  }, [isOpen]);

  const handleSubmit = (name: string) => r.research(name);
  const handleForceRefresh = () => {
    if (r.dossier) r.research(r.dossier.companyName, { forceRefresh: true });
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={onClose}
          data-testid="research-panel"
        >
          <div
            className="bg-bg-elevated rounded-2xl border border-border-subtle shadow-2xl w-full max-w-3xl
                       max-h-[85vh] flex flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="px-6 py-4 border-b border-border-subtle flex items-center">
              <h2 className="text-lg font-semibold text-text-primary flex-1">Research · 公司情报调研</h2>
              <button
                onClick={onClose}
                aria-label="关闭"
                className="p-2 rounded-lg text-text-tertiary hover:bg-bg-input hover:text-text-primary transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-6 py-4">
              <ResearchInput
                onSubmit={handleSubmit}
                disabled={r.stage === 'loading'}
                initialValue={initialCompanyName}
              />

              {r.stage === 'loading' && (
                <ResearchProgress currentStage={r.progressStage ?? 'cache-check'} />
              )}

              {r.stage === 'error' && r.error && (
                <div className="mt-4">
                  <ResearchErrorBanner
                    error={r.error}
                    errorCode={r.errorCode}
                    onRetry={() => r.dossier && r.research(r.dossier.companyName)}
                  />
                </div>
              )}

              {r.stage === 'success' && r.dossier && (
                <div className="mt-6 space-y-4">
                  {r.dossier.source === 'llm-fallback' && <ResearchFallbackBanner />}

                  <div className="text-xs text-text-muted flex gap-3 flex-wrap">
                    <span>{r.dossier.companyName}</span>
                    <span>·</span>
                    <span>{new Date(r.dossier.generatedAt).toLocaleString('zh-CN')}</span>
                    <span>·</span>
                    <span>{r.cached ? '缓存中' : '实时生成'}</span>
                  </div>

                  <div>
                    {DIMENSION_DEFS.map((d) => (
                      <ResearchDimension
                        key={d.key}
                        title={d.title}
                        subtitle={d.subtitle}
                        dimension={(r.dossier as any)[d.key]}
                        sources={r.dossier!.sources}
                      />
                    ))}
                  </div>

                  <div className="pt-4 flex justify-end">
                    <button
                      onClick={handleForceRefresh}
                      className="px-4 py-2 rounded-lg border border-border-subtle
                                 bg-bg-input hover:bg-bg-elevated text-text-primary text-sm inline-flex items-center gap-2 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      强制刷新
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
