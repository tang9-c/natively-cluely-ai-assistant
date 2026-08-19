import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

import type { TranscriptVirtualRow } from '../../../shared/transcriptVirtualization';
import { TranscriptRow } from './TranscriptRow';

interface TranscriptVirtualListProps {
  meetingId: string;
  rows: TranscriptVirtualRow[];
  formatTime: (timestamp: number) => string;
}

export function TranscriptVirtualList({
  meetingId,
  rows,
  formatTime,
}: TranscriptVirtualListProps) {
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
  }, [meetingId, virtualizer]);

  if (rows.length === 0) {
    return <p className="text-text-tertiary">没有可用的转录。</p>;
  }

  const virtualRows = virtualizer.getVirtualItems();
  return (
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
            <TranscriptRow row={rows[virtualRow.index]} formatTime={formatTime} />
          </div>
        ))}
      </div>
    </div>
  );
}
