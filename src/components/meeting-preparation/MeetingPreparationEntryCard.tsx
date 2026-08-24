import React from 'react';
import { ArrowRight, FileCheck2, Mic2, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

interface MeetingPreparationEntryCardProps {
  title: string;
  description: string;
  helper: string;
  onStart: () => void;
}

export const MeetingPreparationEntryCard: React.FC<MeetingPreparationEntryCardProps> = ({
  title,
  description,
  helper,
  onStart,
}) => (
  <motion.button
    type="button"
    data-testid="meeting-preparation-entry"
    onClick={onStart}
    whileHover={{ y: -2 }}
    whileTap={{ scale: 0.995 }}
    className="group relative h-full w-full overflow-hidden rounded-[24px] border border-sky-400/20 bg-gradient-to-br from-sky-500/15 via-bg-elevated to-violet-500/10 p-6 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_18px_45px_rgba(2,132,199,0.10)] transition-colors hover:border-sky-400/40"
  >
    <div className="absolute -right-10 -top-16 h-44 w-44 rounded-full bg-sky-400/20 blur-3xl transition-transform duration-500 group-hover:scale-125" />
    <div className="relative flex h-full flex-col justify-between">
      <div className="flex items-start justify-between gap-6">
        <div>
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-sky-400">
            <Sparkles size={14} aria-hidden="true" />
            AI 会前准备
          </div>
          <h2 className="text-[24px] font-semibold tracking-[-0.03em] text-text-primary">{title}</h2>
          <p className="mt-2 max-w-[530px] text-[13px] leading-5 text-text-secondary">{description}</p>
        </div>
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/10 text-sky-300 shadow-inner">
          <FileCheck2 size={21} aria-hidden="true" />
        </span>
      </div>

      <div className="flex items-end justify-between gap-4">
        <span className="flex items-center gap-2 text-[12px] text-text-tertiary">
          <Mic2 size={14} aria-hidden="true" />
          {helper}
        </span>
        <span className="flex items-center gap-2 rounded-full bg-sky-500 px-4 py-2 text-[12px] font-semibold text-white shadow-lg shadow-sky-500/20 transition-transform group-hover:translate-x-1">
          开始准备
          <ArrowRight size={14} aria-hidden="true" />
        </span>
      </div>
    </div>
  </motion.button>
);
