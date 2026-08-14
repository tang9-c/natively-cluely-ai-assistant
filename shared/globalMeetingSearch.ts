export interface GlobalMeetingSearchHit {
  meetingId: string;
  title: string;
  startTimeMs: number | null;
  snippet: string;
  score: number;
}

export interface GlobalMeetingSearchResponse {
  success: boolean;
  hits: GlobalMeetingSearchHit[];
  degradedReason?: 'rag_unavailable' | 'search_failed';
}
