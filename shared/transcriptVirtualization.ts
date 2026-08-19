import type { SpeakerIdentityCorrection } from './speakerIdentity';

export interface MeetingTranscriptEntry {
  speaker: string;
  text: string;
  timestamp: number;
  speakerIdentityCorrection?: SpeakerIdentityCorrection;
  rawSegmentIds?: string[];
}

export interface TranscriptVirtualRow {
  key: string;
  sourceIndex: number;
  entry: MeetingTranscriptEntry;
}

const HIDDEN_SPEAKERS = new Set(['system', 'ai', 'assistant', 'model']);

export function getTranscriptRowKey(
  entry: MeetingTranscriptEntry,
  sourceIndex: number,
): string {
  if (entry.rawSegmentIds?.length) return `raw:${entry.rawSegmentIds.join('|')}`;
  return `segment:${entry.speaker}:${entry.timestamp}:${sourceIndex}`;
}

export function buildVisibleTranscriptRows(
  transcript: readonly MeetingTranscriptEntry[] = [],
): TranscriptVirtualRow[] {
  const rows: TranscriptVirtualRow[] = [];
  transcript.forEach((entry, sourceIndex) => {
    if (HIDDEN_SPEAKERS.has(entry.speaker?.toLowerCase())) return;
    rows.push({ key: getTranscriptRowKey(entry, sourceIndex), sourceIndex, entry });
  });
  return rows;
}
