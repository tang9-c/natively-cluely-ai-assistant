import type { TranscriptSpeakerVerificationMetadata } from './transcriptIpc';
import type { SpeakerIdentityCorrection } from './speakerIdentity';

export interface Meeting {
    editState?: MeetingEditState;
    id: string;
    title: string;
    date: string; // ISO string
    duration: string;
    summary: string;
    detailedSummary?: {
        overview?: string;
        actionItems: string[];
        keyPoints: string[];
        generationStatus?: 'success' | 'failed';
        decisions?: string[];
        openQuestions?: string[];
        actionItemsTitle?: string;
        keyPointsTitle?: string;
        sections?: Array<{ title: string; bullets: string[] }>;
        schemaVersion?: number;
        actionItemsStructured?: Array<{ id: string; text: string; owner?: string; deadline?: string; sourceTimestamp?: number }>;
        followUpDraft?: string;
        coachingInsights?: Array<{ id: string; type: string; title: string; detail: string; severity: 'info' | 'opportunity' | 'warning'; evidence?: string }>;
    };
    transcript?: Array<{
        segmentId?: string;
        rawSegmentIds?: string[];
        originalContent?: string;
        editRevision?: number;
        speaker: string;
        speakerId?: string;
        speakerLabel?: string;
        providerSpeakerId?: string;
        diarizationProvider?: 'doubao-auc' | 'qcloud';
        text: string;
        timestamp: number;
        startTimestampMs?: number;
        endTimestampMs?: number;
        speakerVerification?: TranscriptSpeakerVerificationMetadata;
        speakerIdentityCorrection?: SpeakerIdentityCorrection;
    }>;
    usage?: Array<{
        type: 'assist' | 'followup' | 'chat' | 'followup_questions';
        timestamp: number;
        question?: string;
        answer?: string;
        items?: string[];
    }>;
    calendarEventId?: string;
    source?: 'manual' | 'calendar';
    isProcessed?: boolean;
}

export interface MeetingEditState {
  meetingRevision: number;
  transcriptRevision: number;
  summarySourceRevision: number;
  editedSummaryFields: string[];
  indexDirty: boolean;
  indexRevision?: number;
}
export type MeetingSummaryPatch = Partial<Pick<NonNullable<Meeting['detailedSummary']>,
  'overview' | 'keyPoints' | 'decisions' | 'openQuestions' | 'sections' | 'actionItemsTitle' | 'keyPointsTitle' | 'actionItemsStructured'>> & { title?: string };
export interface MeetingEditRequest {
  meetingId: string;
  expectedRevision: number;
  operation: { type: 'summary'; patch: MeetingSummaryPatch }
    | { type: 'text'; segmentId: string; text: string }
    | { type: 'identity'; segmentIds: string[]; identity: 'me' | 'other' | 'unknown' | null };
}
export type MeetingEditResult = { ok: true; revision: number; meeting: Meeting }
  | { ok: false; error: 'not_found' | 'conflict' | 'invalid_input' | 'save_failed' };
export function readMeetingEditState(value?: string | null): MeetingEditState {
  const state = value ? JSON.parse(value) : {};
  return {
    meetingRevision: state.meetingRevision ?? 0,
    transcriptRevision: state.transcriptRevision ?? 0,
    summarySourceRevision: state.summarySourceRevision ?? 0,
    editedSummaryFields: state.editedSummaryFields ?? [],
    indexDirty: state.indexDirty ?? false,
    ...(Number.isSafeInteger(state.indexRevision) ? { indexRevision: state.indexRevision } : {}),
  };
}
