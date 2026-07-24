import type {
    MeetingSearchChunkEvent,
    MeetingSearchCompleteEvent,
    MeetingSearchErrorEvent,
    MeetingSearchRequest,
    MeetingSearchResult,
} from '../../shared/meetingSearch';
import type { RAGManager } from './RAGManager';

type MeetingSearchChannel =
    | 'rag:stream-chunk'
    | 'rag:stream-complete'
    | 'rag:stream-error';

type MeetingSearchPayload =
    | MeetingSearchChunkEvent
    | MeetingSearchCompleteEvent
    | MeetingSearchErrorEvent;

const QUERY_FAILED_MESSAGE = '本次会议搜索暂时不可用，请稍后重试。';

export async function executeMeetingSearch(input: {
    ragManager: Pick<RAGManager, 'prepareMeetingQuery' | 'streamMeetingAnswer'>;
    request: MeetingSearchRequest;
    signal: AbortSignal;
    send: (channel: MeetingSearchChannel, payload: MeetingSearchPayload) => void;
}): Promise<MeetingSearchResult> {
    const { ragManager, request, signal, send } = input;
    if (signal.aborted) return { status: 'cancelled' };

    const prepared = await ragManager.prepareMeetingQuery(
        request.meetingId,
        request.query
    );
    if (signal.aborted) return { status: 'cancelled' };
    if (prepared.status !== 'ready') return prepared;

    const baseEvent = {
        requestId: request.requestId,
        meetingId: request.meetingId,
        global: false as const,
    };

    try {
        for await (const chunk of ragManager.streamMeetingAnswer(prepared, signal)) {
            if (signal.aborted) return { status: 'cancelled' };
            send('rag:stream-chunk', { ...baseEvent, chunk });
        }
        if (signal.aborted) return { status: 'cancelled' };

        send('rag:stream-complete', baseEvent);
        return { status: 'success' };
    } catch {
        if (signal.aborted) return { status: 'cancelled' };

        const result = {
            status: 'query_failed' as const,
            message: QUERY_FAILED_MESSAGE,
        };
        send('rag:stream-error', { ...baseEvent, ...result });
        return result;
    }
}
