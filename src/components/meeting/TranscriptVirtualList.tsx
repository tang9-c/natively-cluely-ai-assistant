import { useEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { TranscriptVirtualRow } from '../../../shared/transcriptVirtualization';
import { SpeakerIdentityMenu, type IdentityChoice } from './SpeakerIdentityMenu';
import { TranscriptRow } from './TranscriptRow';

interface TranscriptVirtualListProps {
  meetingId: string;
  rows: TranscriptVirtualRow[];
  onIdentityChange?: (ids: string[], identity: IdentityChoice) => Promise<boolean>;
  saving?: boolean;
  formatTime: (timestamp: number) => string;
}

export function TranscriptVirtualList({
  meetingId,
  rows,
  formatTime, onIdentityChange, saving,
}: TranscriptVirtualListProps) {
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 76,
    getItemKey: index => rows[index].key,
    measureElement: element => element.getBoundingClientRect().height,
    overscan: 8,
  });

  useEffect(() => {
    virtualizer.scrollToOffset(0);
    setSelected(null);
  }, [meetingId, virtualizer]);

  if (rows.length === 0) {
    return <p className="text-text-tertiary">没有可用的转录。</p>;
  }

  const virtualRows = virtualizer.getVirtualItems();
  return (
    <>
    {selected && <div className="mb-3 flex items-center gap-3 text-xs text-text-secondary">
      <span>已选 {selected.size} 段</span>
      {onIdentityChange && <SpeakerIdentityMenu segment={{}} label="批量修改身份" disabled={saving || selected.size === 0}
        onChange={async identity => { const ok = await onIdentityChange([...selected], identity); if (ok) setSelected(null); return ok; }} />}
      <button type="button" disabled={saving} onClick={() => setSelected(null)}>取消选择</button>
    </div>}
    <div
      ref={scrollRef}
      className="h-[calc(100vh-260px)] min-h-[320px] overflow-y-auto custom-scrollbar"
      data-transcript-total-count={rows.length}
      data-transcript-rendered-count={virtualRows.length}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualRows.map(virtualRow => (
          <div
            key={virtualRow.key}
            ref={virtualizer.measureElement}
            data-index={virtualRow.index}
            className="absolute left-0 top-0 w-full"
            style={{ transform: `translateY(${virtualRow.start}px)` }}
          >
            <TranscriptRow row={rows[virtualRow.index]} formatTime={formatTime} onIdentityChange={onIdentityChange} saving={saving}
              selecting={selected !== null} selected={selected?.has(rows[virtualRow.index].entry.segmentId ?? '')}
              onSelect={() => setSelected(new Set([rows[virtualRow.index].entry.segmentId!]))}
              onToggle={() => setSelected(current => { const next = new Set(current ?? []); const id = rows[virtualRow.index].entry.segmentId!;
                if (next.has(id)) next.delete(id); else next.add(id); return next; })} />
          </div>
        ))}
      </div>
    </div>
    </>
  );
}
