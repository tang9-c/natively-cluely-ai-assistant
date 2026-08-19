import React from 'react';

import { resolveEffectiveSpeaker } from '../../../shared/speakerIdentity';
import type { TranscriptVirtualRow } from '../../../shared/transcriptVirtualization';

interface TranscriptRowProps {
  row: TranscriptVirtualRow;
  formatTime: (timestamp: number) => string;
}

export const TranscriptRow = React.memo(function TranscriptRow({
  row,
  formatTime,
}: TranscriptRowProps) {
  const { entry } = row;
  return (
    <div className="group pb-6" data-transcript-row-key={row.key}>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-xs font-semibold text-text-secondary">
          {resolveEffectiveSpeaker(entry) === 'user' ? '我' : '对方'}
        </span>
        <span className="font-mono text-xs text-text-tertiary">
          {entry.timestamp ? formatTime(entry.timestamp) : '0:00'}
        </span>
      </div>
      <p className="cursor-text select-text text-[15px] leading-relaxed text-text-secondary transition-colors">
        {entry.text}
      </p>
    </div>
  );
});
