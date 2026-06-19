// src/components/research/ResearchProgress.tsx
//
// Inline progress indicator for the three high-level stages of the
// research pipeline: cache lookup, parallel search, then synthesis.
// Each step lights up once `currentStage` has reached (or passed) it.

const STAGES = [
  { key: 'cache-check', label: '正在检查缓存...' },
  { key: 'searching', label: '正在搜索（6 个查询）...' },
  { key: 'synthesizing', label: '正在综合 AI 报告...' },
] as const;

export function ResearchProgress({ currentStage }: { currentStage: string }) {
  return (
    <div className="flex flex-col gap-2 py-3" aria-live="polite">
      {STAGES.map((s, idx) => {
        const currentIdx = STAGES.findIndex((x) => x.key === currentStage);
        const reached = currentIdx >= idx;
        return (
          <div key={s.key} className="flex items-center gap-2 text-sm">
            <span className={reached ? 'text-accent-primary' : 'text-text-muted'}>
              {reached ? '●' : '○'}
            </span>
            <span className={reached ? 'text-text-primary' : 'text-text-muted'}>
              {s.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
