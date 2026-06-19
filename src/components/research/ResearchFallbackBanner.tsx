// src/components/research/ResearchFallbackBanner.tsx
//
// Warning banner shown when a dossier was produced without real-time
// search (LLM fallback path). Sets the user's expectation that every
// bullet's confidence will be `low` and the report is generated
// purely from the model's training data.

import { AlertTriangle } from 'lucide-react';

export function ResearchFallbackBanner() {
  return (
    <div className="rounded-lg p-3 bg-yellow-500/10 border border-yellow-500/30 text-yellow-200 text-sm flex items-start gap-2">
      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <span>本报告未经过实时搜索验证，仅基于模型训练知识。每条要点 confidence 为 low，仅供参考。</span>
    </div>
  );
}
