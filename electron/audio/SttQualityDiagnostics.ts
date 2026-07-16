export type SttQualityDiagnosticStatus = 'completed' | 'failed' | 'skipped' | 'drain_timeout';

export interface RestSttUploadDiagnostic {
    code: 'rest_stt_upload_diagnostics';
    runtimeSessionId?: string;
    provider: string;
    speaker: string;
    captureBackend?: string;
    inputSampleRate?: number;
    inputChannelCount?: number;
    policyProfile?: string;
    preprocessingProfile?: string;
    segmentSequence: number;
    trigger: string;
    inputDurationMs: number;
    bufferedBytes: number;
    inputChunkCount: number;
    inputChunkBytesMin: number;
    inputChunkBytesMedian: number;
    inputChunkBytesMax: number;
    queuedWaitMs?: number;
    speechEndToUploadStartMs?: number;
    uploadLatencyMs?: number;
    speechEndToFinalMs?: number;
    outputChars: number;
    duplicateBoundaryDetected: boolean;
    status: SttQualityDiagnosticStatus;
}

export interface SttQualityMeetingMappingDiagnostic {
    code: 'stt_quality_meeting_mapping';
    runtimeSessionId: string;
    meetingId: string;
}

export type SttQualityDiagnostic = RestSttUploadDiagnostic | SttQualityMeetingMappingDiagnostic;

const TRANSCRIPT_LIKE_KEYS = new Set([
    'text',
    'transcript',
    'prompt',
    'body',
    'requestBody',
    'responseBody',
    'providerResponse',
    'apiKey',
    'token',
]);

const REST_UPLOAD_KEYS = new Set([
    'code',
    'runtimeSessionId',
    'provider',
    'speaker',
    'captureBackend',
    'inputSampleRate',
    'inputChannelCount',
    'policyProfile',
    'preprocessingProfile',
    'segmentSequence',
    'trigger',
    'inputDurationMs',
    'bufferedBytes',
    'inputChunkCount',
    'inputChunkBytesMin',
    'inputChunkBytesMedian',
    'inputChunkBytesMax',
    'queuedWaitMs',
    'speechEndToUploadStartMs',
    'uploadLatencyMs',
    'speechEndToFinalMs',
    'outputChars',
    'duplicateBoundaryDetected',
    'status',
]);

const MEETING_MAPPING_KEYS = new Set(['code', 'runtimeSessionId', 'meetingId']);

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function hasOnlyAllowedKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
    for (const key of Object.keys(value)) {
        if (TRANSCRIPT_LIKE_KEYS.has(key) || !allowed.has(key)) return false;
    }
    return true;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return isFiniteNumber(value) ? value : undefined;
}

export function sanitizeSttQualityDiagnostic(value: unknown): SttQualityDiagnostic | null {
    if (!value || typeof value !== 'object') return null;
    const raw = value as Record<string, unknown>;
    if (raw.code === 'stt_quality_meeting_mapping') {
        if (!hasOnlyAllowedKeys(raw, MEETING_MAPPING_KEYS)) return null;
        if (typeof raw.runtimeSessionId !== 'string' || typeof raw.meetingId !== 'string') return null;
        return {
            code: 'stt_quality_meeting_mapping',
            runtimeSessionId: raw.runtimeSessionId,
            meetingId: raw.meetingId,
        };
    }
    if (raw.code !== 'rest_stt_upload_diagnostics') return null;
    if (!hasOnlyAllowedKeys(raw, REST_UPLOAD_KEYS)) return null;
    if (
        typeof raw.provider !== 'string'
        || typeof raw.speaker !== 'string'
        || typeof raw.trigger !== 'string'
        || typeof raw.status !== 'string'
        || !isFiniteNumber(raw.segmentSequence)
        || !isFiniteNumber(raw.inputDurationMs)
        || !isFiniteNumber(raw.bufferedBytes)
        || !isFiniteNumber(raw.inputChunkCount)
        || !isFiniteNumber(raw.inputChunkBytesMin)
        || !isFiniteNumber(raw.inputChunkBytesMedian)
        || !isFiniteNumber(raw.inputChunkBytesMax)
        || !isFiniteNumber(raw.outputChars)
        || typeof raw.duplicateBoundaryDetected !== 'boolean'
    ) {
        return null;
    }
    return {
        code: 'rest_stt_upload_diagnostics',
        runtimeSessionId: optionalString(raw.runtimeSessionId),
        provider: raw.provider,
        speaker: raw.speaker,
        captureBackend: optionalString(raw.captureBackend),
        inputSampleRate: optionalNumber(raw.inputSampleRate),
        inputChannelCount: optionalNumber(raw.inputChannelCount),
        policyProfile: optionalString(raw.policyProfile),
        preprocessingProfile: optionalString(raw.preprocessingProfile),
        segmentSequence: raw.segmentSequence,
        trigger: raw.trigger,
        inputDurationMs: raw.inputDurationMs,
        bufferedBytes: raw.bufferedBytes,
        inputChunkCount: raw.inputChunkCount,
        inputChunkBytesMin: raw.inputChunkBytesMin,
        inputChunkBytesMedian: raw.inputChunkBytesMedian,
        inputChunkBytesMax: raw.inputChunkBytesMax,
        queuedWaitMs: optionalNumber(raw.queuedWaitMs),
        speechEndToUploadStartMs: optionalNumber(raw.speechEndToUploadStartMs),
        uploadLatencyMs: optionalNumber(raw.uploadLatencyMs),
        speechEndToFinalMs: optionalNumber(raw.speechEndToFinalMs),
        outputChars: raw.outputChars,
        duplicateBoundaryDetected: raw.duplicateBoundaryDetected,
        status: raw.status as SttQualityDiagnosticStatus,
    };
}
