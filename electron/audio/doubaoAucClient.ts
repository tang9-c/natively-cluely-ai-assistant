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
