import React from 'react';

import { resolveSpeakerIdentity } from '../../../shared/speakerIdentity';
import { SpeakerIdentityMenu, type IdentityChoice } from './SpeakerIdentityMenu';
import type { TranscriptVirtualRow } from '../../../shared/transcriptVirtualization';

interface TranscriptRowProps {
  row: TranscriptVirtualRow;
  onIdentityChange?: (ids: string[], identity: IdentityChoice) => Promise<boolean>;
  onSelect?: () => void;
  selecting?: boolean;
  selected?: boolean;
  onToggle?: () => void;
  saving?: boolean;
  formatTime: (timestamp: number) => string;
}

export const TranscriptRow = React.memo(function TranscriptRow({
  row,
  formatTime, onIdentityChange, onSelect, selecting, selected, onToggle, saving,
}: TranscriptRowProps) {
  const { entry } = row;
  return (
    <div className="group pb-6" data-transcript-row-key={row.key}>
      <div className="mb-1 flex items-center gap-2">
        {selecting && <input type="checkbox" aria-label="选择发言片段" checked={selected} onChange={onToggle} disabled={saving} />}
        {onIdentityChange && entry.segmentId ? <SpeakerIdentityMenu segment={entry} disabled={saving}
          onChange={identity => onIdentityChange([entry.segmentId!], identity)} onSelect={onSelect} />
          : <span className="text-xs font-semibold text-text-secondary">{resolveSpeakerIdentity(entry).label}</span>}
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
