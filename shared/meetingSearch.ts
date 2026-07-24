export interface MeetingSearchRequest {
    meetingId: string;
    query: string;
    requestId: string;
}

export type MeetingSearchFailureStatus =
    | 'meeting_not_found'
    | 'transcript_unavailable'
    | 'scope_denied'
    | 'llm_unavailable'
    | 'query_failed';

export type MeetingSearchResult =
    | { status: 'success' }
    | { status: 'cancelled' }
    | { status: 'no_match'; message: string }
    | { status: MeetingSearchFailureStatus; message: string };

export interface MeetingSearchStreamEvent {
    requestId: string;
    meetingId: string;
    global?: false;
}

export type MeetingSearchChunkEvent =
    MeetingSearchStreamEvent & { chunk: string };

export type MeetingSearchCompleteEvent = MeetingSearchStreamEvent;

export type MeetingSearchErrorEvent = MeetingSearchStreamEvent & {
    status: MeetingSearchFailureStatus;
    message: string;
};
