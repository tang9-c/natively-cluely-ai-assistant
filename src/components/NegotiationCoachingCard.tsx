import React from 'react';
import { MessageSquare, Clock, Target, DollarSign } from 'lucide-react';

interface NegotiationCoachingCardProps {
  tacticalNote: string;
  exactScript: string;
  showSilenceTimer: boolean;
  phase: string;
  theirOffer: number | null;
  yourTarget: number | null;
  currency: string;
  onSilenceTimerEnd?: () => void;
}

export const NegotiationCoachingCard: React.FC<NegotiationCoachingCardProps> = ({
  tacticalNote,
  exactScript,
  showSilenceTimer,
  phase,
  theirOffer,
  yourTarget,
  currency,
  onSilenceTimerEnd,
}) => {
  React.useEffect(() => {
    if (!showSilenceTimer) return;
    const timer = setTimeout(() => {
      onSilenceTimerEnd?.();
    }, 7000);
    return () => clearTimeout(timer);
  }, [showSilenceTimer, onSilenceTimerEnd]);

  const formatMoney = (val: number | null) => {
    if (val == null) return '—';
    return `${currency || '$'}${val.toLocaleString()}`;
  };

  return (
    <div className="w-full my-2 rounded-xl border border-purple-500/20 bg-purple-500/5 backdrop-blur-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-purple-500/10">
        <MessageSquare size={14} className="text-purple-400" />
        <span className="text-xs font-semibold text-purple-300 uppercase tracking-wider">
          谈判辅导
        </span>
        <span className="text-[10px] text-purple-400/60 ml-1">{phase}</span>
        {showSilenceTimer && (
          <div className="ml-auto flex items-center gap-1 text-[10px] text-purple-400/80">
            <Clock size={10} />
            <span>保持沉默…</span>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-3.5 py-3 space-y-3">
        {/* Tactical note */}
        {tacticalNote && (
          <div className="text-sm text-text-primary leading-relaxed">
            {tacticalNote}
          </div>
        )}

        {/* Suggested script */}
        {exactScript && (
          <div className="rounded-lg bg-purple-500/10 border border-purple-500/10 p-3">
            <div className="text-[10px] font-medium text-purple-400 uppercase tracking-wider mb-1.5 flex items-center gap-1">
              <Target size={10} />
              建议话术
            </div>
            <p className="text-sm text-purple-100/90 italic leading-relaxed">
              "{exactScript}"
            </p>
          </div>
        )}

        {/* Numbers */}
        {(theirOffer != null || yourTarget != null) && (
          <div className="flex items-center gap-4 pt-1">
            {theirOffer != null && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <DollarSign size={12} className="text-purple-400/60" />
                <span>对方报价: {formatMoney(theirOffer)}</span>
              </div>
            )}
            {yourTarget != null && (
              <div className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Target size={12} className="text-purple-400/60" />
                <span>你的目标: {formatMoney(yourTarget)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
