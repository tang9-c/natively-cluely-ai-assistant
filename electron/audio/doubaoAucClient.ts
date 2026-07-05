import FormData from 'form-data';

export interface DoubaoAucHttpResponse {
    data: any;
    headers: Record<string, any>;
}

export type DoubaoAucPost = (
    url: string,
    body: any,
    options: { headers: Record<string, string>; timeout: number }
) => Promise<DoubaoAucHttpResponse>;

export interface DoubaoAucTranscribeOptions {
    submitEndpoint: string;
    queryEndpoint: string;
    authHeader: Record<string, string>;
    requestBody: any;
    extractTranscript: (data: any) => string;
    post: DoubaoAucPost;
    requestId?: string;
    pollIntervalMs?: number;
    maxAttempts?: number;
    submitTimeoutMs?: number;
    queryTimeoutMs?: number;
    logger?: Pick<Console, 'log'>;
}

export interface NewApiDoubaoAucMultipartOptions {
    submitEndpoint: string;
    queryEndpoint: string;
    authHeader: Record<string, string>;
    audioBuffer: Buffer;
    filename: string;
    contentType: string;
    formFields: Record<string, string>;
    extractTranscript: (data: any) => string;
    post: DoubaoAucPost;
    pollIntervalMs?: number;
    maxAttempts?: number;
    submitTimeoutMs?: number;
    queryTimeoutMs?: number;
    logger?: Pick<Console, 'log'>;
}

export interface DoubaoAucUtterance {
    text: string;
    startMs?: number;
    endMs?: number;
    providerSpeakerId?: string;
    emotion?: DoubaoAucEmotion;
    emotionDegree?: DoubaoAucEmotionDegree;
    emotionScore?: number;
    emotionDegreeScore?: number;
}

export type DoubaoAucEmotion =
    | 'happy'
    | 'sad'
    | 'angry'
    | 'fearful'
    | 'disgusted'
    | 'surprised'
    | 'neutral';

export type DoubaoAucEmotionDegree = 'weak' | 'medium' | 'strong';

export interface DoubaoAucTranscriptionResult {
    text: string;
    utterances: DoubaoAucUtterance[];
}

const AUC_STATUS_OK = '20000000';
const AUC_STATUS_PROCESSING = new Set(['20000001', '20000002']);
const AUC_STATUS_SILENT = '20000003';

function createRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
}

function readHeader(headers: Record<string, any>, name: string): string | undefined {
    const lowerName = name.toLowerCase();
    const value = headers[name] ?? headers[lowerName];
    if (Array.isArray(value)) {
        return value[0] == null ? undefined : String(value[0]);
    }
    return value == null ? undefined : String(value);
}

function wait(ms: number): Promise<void> {
    if (ms <= 0) return Promise.resolve();
    return new Promise(resolve => setTimeout(resolve, ms));
}

function readNumber(value: any): number | undefined {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
}

function readSpeakerId(item: any): string | undefined {
    const value = item?.speaker_id
        ?? item?.speakerId
        ?? item?.speaker
        ?? item?.additions?.speaker_id
        ?? item?.additions?.speakerId
        ?? item?.additions?.speaker;
    if (value == null || value === '') return undefined;
    return String(value);
}

function readEmotion(additions: any): DoubaoAucEmotion | undefined {
    const value = additions?.emotion;
    return value === 'happy'
        || value === 'sad'
        || value === 'angry'
        || value === 'fearful'
        || value === 'disgusted'
        || value === 'surprised'
        || value === 'neutral'
        ? value
        : undefined;
}

function readEmotionDegree(additions: any): DoubaoAucEmotionDegree | undefined {
    const value = additions?.emotion_degree ?? additions?.emotionDegree;
    return value === 'weak' || value === 'medium' || value === 'strong' ? value : undefined;
}

function readOptionalScore(value: any): number | undefined {
    const parsed = readNumber(value);
    return parsed == null || parsed < 0 || parsed > 1 ? undefined : parsed;
}

export function extractDoubaoAucTranscript(data: any): string {
    if (typeof data === 'string') return data;

    if (typeof data?.result?.text === 'string') {
        return data.result.text;
    }

    if (Array.isArray(data?.result?.utterances)) {
        return data.result.utterances
            .map((item: any) => item?.text || item?.transcription || '')
            .filter(Boolean)
            .join(' ');
    }

    const result = data?.result || data?.resp_speech_info;
    if (Array.isArray(result) && result.length > 0) {
        return result
            .map((item: any) => item?.text || item?.transcription || '')
            .filter(Boolean)
            .join(' ');
    }

    return data?.text || data?.transcription || '';
}

export function extractDoubaoAucTranscription(data: any): DoubaoAucTranscriptionResult {
    if (typeof data === 'string') {
        return { text: data, utterances: data.trim() ? [{ text: data }] : [] };
    }

    const result = data?.result || data?.resp_speech_info;
    const utteranceSource = Array.isArray(data?.result?.utterances)
        ? data.result.utterances
        : Array.isArray(result)
            ? result
            : [];

    const utterances: DoubaoAucUtterance[] = utteranceSource
        .map((item: any): DoubaoAucUtterance | null => {
            const text = item?.text || item?.transcription || '';
            if (!text) return null;
            const additions = item?.additions;
            const emotion = readEmotion(additions);
            const emotionDegree = readEmotionDegree(additions);
            const emotionScore = readOptionalScore(additions?.emotion_score ?? additions?.emotionScore);
            const emotionDegreeScore = readOptionalScore(additions?.emotion_degree_score ?? additions?.emotionDegreeScore);
            return {
                text,
                startMs: readNumber(item?.start_time ?? item?.startMs),
                endMs: readNumber(item?.end_time ?? item?.endMs),
                providerSpeakerId: readSpeakerId(item),
                ...(emotion ? { emotion } : {}),
                ...(emotionDegree ? { emotionDegree } : {}),
                ...(emotionScore != null ? { emotionScore } : {}),
                ...(emotionDegreeScore != null ? { emotionDegreeScore } : {}),
            };
        })
        .filter((item: DoubaoAucUtterance | null): item is DoubaoAucUtterance => item !== null);

    const text = typeof data?.result?.text === 'string'
        ? data.result.text
        : typeof data?.text === 'string'
            ? data.text
            : utterances.map((item: DoubaoAucUtterance) => item.text).join(' ');

    if (utterances.length === 0 && text.trim().length > 0) {
        return { text, utterances: [{ text }] };
    }

    return { text, utterances };
}

export function extractDoubaoAucTranscriptionJson(data: any): string {
    const result = extractDoubaoAucTranscription(data);
    if (result.text.trim().length === 0 && result.utterances.length === 0) {
        return '';
    }

    return JSON.stringify(result);
}

export async function transcribeNewApiDoubaoAucMultipartFile(
    options: NewApiDoubaoAucMultipartOptions,
): Promise<string> {
    const form = new FormData();
    form.append('file', options.audioBuffer, {
        filename: options.filename,
        contentType: options.contentType,
    });
    for (const [key, value] of Object.entries(options.formFields)) {
        form.append(key, value);
    }

    const submitResponse = await options.post(options.submitEndpoint, form, {
        headers: {
            ...options.authHeader,
            ...form.getHeaders(),
        },
        timeout: options.submitTimeoutMs ?? 30000,
    });

    const taskId = submitResponse.data?.task_id;
    if (!taskId) {
        throw new Error('QCLOUD API AUC submit did not return task_id');
    }

    const pollIntervalMs = options.pollIntervalMs ?? 2000;
    const maxAttempts = options.maxAttempts ?? 60;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempt > 0 && pollIntervalMs > 0) await wait(pollIntervalMs);
        const queryResponse = await options.post(options.queryEndpoint, { task_id: taskId }, {
            headers: {
                ...options.authHeader,
                'Content-Type': 'application/json',
            },
            timeout: options.queryTimeoutMs ?? 15000,
        });

        const statusCode = String(queryResponse.data?.status_code || '');
        options.logger?.log('[RestSTT] QCLOUD API AUC query status:', {
            attempt: attempt + 1,
            statusCode,
        });
        if (statusCode === AUC_STATUS_OK || statusCode === AUC_STATUS_SILENT) {
            return options.extractTranscript(queryResponse.data);
        }
        if (!AUC_STATUS_PROCESSING.has(statusCode)) {
            throw new Error(`QCLOUD API AUC task failed with status: ${statusCode || 'unknown'}`);
        }
    }

    throw new Error('QCLOUD API AUC transcription timed out');
}

export async function transcribeDoubaoAucFile(options: DoubaoAucTranscribeOptions): Promise<string> {
    const {
        submitEndpoint,
        queryEndpoint,
        authHeader,
        requestBody,
        extractTranscript,
        post,
        pollIntervalMs = 500,
        maxAttempts = 60,
        submitTimeoutMs = 30000,
        queryTimeoutMs = 15000,
        logger,
    } = options;
    const requestId = options.requestId || createRequestId();

    const submitResponse = await post(submitEndpoint, requestBody, {
        headers: {
            ...authHeader,
            'Content-Type': 'application/json',
            'X-Api-Request-Id': requestId,
            'X-Api-Sequence': '-1',
        },
        timeout: submitTimeoutMs,
    });

    logger?.log('[RestSTT] Doubao AUC submit response:', submitResponse.data);
    logger?.log('[RestSTT] Doubao AUC submit headers:', submitResponse.headers);

    const submitStatusCode = readHeader(submitResponse.headers, 'x-api-status-code');
    if (submitStatusCode && submitStatusCode !== AUC_STATUS_OK) {
        throw new Error(`Doubao AUC submit failed with status: ${submitStatusCode}, message: ${readHeader(submitResponse.headers, 'x-api-message') || 'Unknown'}`);
    }

    const immediateResult = extractTranscript(submitResponse.data);
    if (immediateResult && immediateResult.trim().length > 0) {
        return immediateResult;
    }

    const xTtLogid = readHeader(submitResponse.headers, 'x-tt-logid');

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await wait(pollIntervalMs);

        const queryHeaders: Record<string, string> = {
            ...authHeader,
            'Content-Type': 'application/json',
            'X-Api-Request-Id': requestId,
        };
        if (xTtLogid) {
            queryHeaders['X-Tt-Logid'] = xTtLogid;
        }

        const queryResponse = await post(queryEndpoint, {}, {
            headers: queryHeaders,
            timeout: queryTimeoutMs,
        });

        logger?.log(`[RestSTT] Doubao AUC query attempt ${attempt + 1}:`, queryResponse.data);
        logger?.log('[RestSTT] Doubao AUC query headers:', queryResponse.headers);

        const queryStatusCode = readHeader(queryResponse.headers, 'x-api-status-code');
        if (!queryStatusCode || queryStatusCode === AUC_STATUS_OK) {
            return extractTranscript(queryResponse.data);
        }
        if (queryStatusCode === AUC_STATUS_SILENT) {
            return '';
        }
        if (!AUC_STATUS_PROCESSING.has(queryStatusCode)) {
            throw new Error(`Doubao AUC task failed with status: ${queryStatusCode}, message: ${readHeader(queryResponse.headers, 'x-api-message') || 'Unknown'}`);
        }
    }

    throw new Error('Doubao AUC transcription timed out after 30 seconds');
}
