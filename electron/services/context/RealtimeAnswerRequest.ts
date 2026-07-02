import type { ModeEventContext } from '../../llm/WhatToAnswerLLM';

export type RealtimeAnswerStatusCode =
    | 'ok'
    | 'invalid-request'
    | 'no-context'
    | 'no-result'
    | 'retrieval-error'
    | 'permission-denied'
    | 'scope-rejected'
    | 'provider-error'
    | 'answer-trace-unavailable';

export interface SanitizedGenerateWhatToSayOptions {
    promptInstruction?: string;
    persist?: boolean;
    source?: 'overlay' | 'launcher' | 'dynamic_action';
    modeEvent?: ModeEventContext;
}

const VALID_SOURCES = new Set(['overlay', 'launcher', 'dynamic_action']);

export function sanitizeGenerateWhatToSayOptions(input: unknown): SanitizedGenerateWhatToSayOptions {
    if (!input || typeof input !== 'object') return {};
    const raw = input as Record<string, unknown>;
    const sanitized: SanitizedGenerateWhatToSayOptions = {};

    if (typeof raw.promptInstruction === 'string' && raw.promptInstruction.trim()) {
        sanitized.promptInstruction = raw.promptInstruction;
    }
    if (typeof raw.persist === 'boolean') {
        sanitized.persist = raw.persist;
    }
    if (typeof raw.source === 'string' && VALID_SOURCES.has(raw.source)) {
        sanitized.source = raw.source as SanitizedGenerateWhatToSayOptions['source'];
    }
    if (raw.modeEvent && typeof raw.modeEvent === 'object') {
        sanitized.modeEvent = raw.modeEvent as ModeEventContext;
    }

    return sanitized;
}
