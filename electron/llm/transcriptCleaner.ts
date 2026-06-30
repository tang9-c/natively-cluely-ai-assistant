// electron/llm/transcriptCleaner.ts
// Deterministic transcript cleaner - NO LLM calls
// Fast string-based processing for interview copilot

export interface TranscriptTurn {
    role: 'interviewer' | 'user' | 'assistant';
    text: string;
    timestamp: number;
    speakerId?: string;
    speakerLabel?: string;
    providerSpeakerId?: string;
    diarizationProvider?: 'doubao-auc';
    speakerVerification?: import('../services/speaker/speakerVerificationTypes').SpeakerVerificationMetadata;
}

/**
 * Filler words and verbal acknowledgements to remove
 */
const FILLER_WORDS = new Set([
    'uh', 'um', 'ah', 'hmm', 'hm', 'er', 'erm',
    'like', 'you know', 'i mean', 'basically', 'actually',
    'so', 'well', 'anyway', 'anyways'
]);

const ACKNOWLEDGEMENTS = new Set([
    'okay', 'ok', 'yeah', 'yes', 'right', 'sure', 'got it',
    'gotcha', 'uh-huh', 'uh huh', 'mm-hmm', 'mm hmm', 'mhm',
    'cool', 'great', 'nice', 'perfect', 'alright', 'all right'
]);

function cjkCharCount(text: string): number {
    return text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
}

/**
 * Clean a single turn's text
 * Removes fillers, acknowledgements, and cleans up formatting
 */
function cleanText(text: string): string {
    let result = text.toLowerCase().trim();

    // Remove repeated words (yeah yeah, okay okay)
    result = result.replace(/\b(\w+)(\s+\1)+\b/gi, '$1');

    // Split into words and filter
    const words = result.split(/\s+/);
    const cleaned = words.filter(word => {
        const normalized = word.replace(/[.,!?;:]/g, '');
        return !FILLER_WORDS.has(normalized) &&
            !ACKNOWLEDGEMENTS.has(normalized);
    });

    // Reconstruct
    result = cleaned.join(' ').trim();

    // Clean up punctuation
    result = result.replace(/\s+([.,!?;:])/g, '$1');
    result = result.replace(/([.,!?;:])+/g, '$1');
    result = result.replace(/\s+/g, ' ');

    return result;
}

/**
 * Check if a turn is meaningful enough to keep
 */
function isMeaningfulTurn(turn: TranscriptTurn, cleanedText: string): boolean {
    // Always keep interviewer speech (priority)
    if (turn.role === 'interviewer' && cleanedText.length >= 5) {
        return true;
    }

    if (cjkCharCount(cleanedText) >= 8 && cleanedText.length >= 10) {
        return true;
    }

    // Minimum 3 words for other roles
    const wordCount = cleanedText.split(/\s+/).filter(w => w.length > 0).length;
    if (wordCount < 3) {
        return false;
    }

    // Skip pure filler turns
    if (cleanedText.length < 10) {
        return false;
    }

    return true;
}

/**
 * Clean transcript buffer
 * Removes fillers, acknowledgements, and non-meaningful turns
 * Returns cleaned array preserving order
 */
export function cleanTranscript(turns: TranscriptTurn[]): TranscriptTurn[] {
    const cleaned: TranscriptTurn[] = [];

    for (const turn of turns) {
        const cleanedText = cleanText(turn.text);

        if (isMeaningfulTurn(turn, cleanedText)) {
            cleaned.push({
                role: turn.role,
                text: cleanedText,
                timestamp: turn.timestamp,
                speakerId: turn.speakerId,
                speakerLabel: turn.speakerLabel,
                providerSpeakerId: turn.providerSpeakerId,
                diarizationProvider: turn.diarizationProvider,
                speakerVerification: turn.speakerVerification,
            });
        }
    }

    return cleaned;
}

function turnKey(turn: TranscriptTurn): string {
    return `${turn.timestamp}|${turn.role}|${turn.speakerId ?? ''}|${turn.speakerLabel ?? ''}|${turn.text}`;
}

function speakerKey(turn: TranscriptTurn): string {
    return (turn.speakerId || turn.speakerLabel || turn.role).trim();
}

function findPreviousTurn(turns: TranscriptTurn[], turn: TranscriptTurn): TranscriptTurn | null {
    const index = turns.indexOf(turn);
    if (index <= 0) return null;
    return turns[index - 1];
}

/**
 * Sparsify transcript to target turn count
 * Preserves the latest anchor, speaker diversity, and recent context
 * Target: 8-12 turns, ~300-600 tokens
 */
export function sparsifyTranscript(
    turns: TranscriptTurn[],
    maxTurns: number = 12
): TranscriptTurn[] {
    if (maxTurns <= 0 || turns.length === 0) return [];

    const ordered = [...turns].sort((a, b) => a.timestamp - b.timestamp);
    if (ordered.length <= maxTurns) {
        return ordered;
    }

    const selected = new Map<string, TranscriptTurn>();
    const add = (turn: TranscriptTurn | null | undefined): void => {
        if (!turn || selected.size >= maxTurns) return;
        selected.set(turnKey(turn), turn);
    };
    const findLatestByRole = (role: TranscriptTurn['role']): TranscriptTurn | undefined => {
        for (let i = ordered.length - 1; i >= 0; i--) {
            if (ordered[i].role === role) return ordered[i];
        }
        return undefined;
    };

    // The newest cleaned turn is the trigger anchor for answer generation.
    add(ordered[ordered.length - 1]);

    // Keep the latest contribution from each role before considering density.
    add(findLatestByRole('user'));
    add(findLatestByRole('interviewer'));
    add(findLatestByRole('assistant'));

    // In meetings, several humans can all be role=interviewer; keep each voice.
    const seenSpeakers = new Set<string>();
    for (let i = ordered.length - 1; i >= 0 && selected.size < maxTurns; i--) {
        const turn = ordered[i];
        if (turn.role === 'assistant') continue;
        const key = speakerKey(turn);
        if (seenSpeakers.has(key)) continue;
        seenSpeakers.add(key);
        add(turn);
    }

    // Preserve immediate lead-in for selected anchors when budget allows.
    const anchors = Array.from(selected.values()).sort((a, b) => b.timestamp - a.timestamp);
    for (const anchor of anchors) {
        if (selected.size >= maxTurns) break;
        add(findPreviousTurn(ordered, anchor));
    }

    // Fill remaining slots with the most recent turns.
    for (let i = ordered.length - 1; i >= 0 && selected.size < maxTurns; i--) {
        add(ordered[i]);
    }

    return Array.from(selected.values()).sort((a, b) => a.timestamp - b.timestamp);
}

function baseRoleLabel(role: TranscriptTurn['role']): string {
    return role === 'interviewer' ? 'INTERVIEWER' : role === 'user' ? 'ME' : 'ASSISTANT';
}

function verificationLabel(turn: TranscriptTurn): string | null {
    return turn.speakerVerification?.isMe === true ? 'ME' : null;
}

function shouldShowSpeakerLabel(turn: TranscriptTurn, label: string): boolean {
    const normalized = label.trim().toLowerCase();
    if (!normalized) return false;
    const genericLabels: Record<TranscriptTurn['role'], Set<string>> = {
        interviewer: new Set(['interviewer']),
        user: new Set(['me', 'user', 'candidate']),
        assistant: new Set(['assistant']),
    };
    return !genericLabels[turn.role].has(normalized);
}

/**
 * Format cleaned transcript for LLM input
 */
export function formatTranscriptForLLM(turns: TranscriptTurn[]): string {
    return turns.map(turn => {
        const verified = verificationLabel(turn);
        if (verified) {
            return `[${verified}]: ${turn.text}`;
        }
        const baseLabel = baseRoleLabel(turn.role);
        const speakerLabel = verified ?? turn.speakerLabel?.trim();
        const label = speakerLabel && shouldShowSpeakerLabel(turn, speakerLabel)
            ? `${baseLabel}: ${speakerLabel}`
            : baseLabel;
        return `[${label}]: ${turn.text}`;
    }).join('\n');
}

/**
 * Full pipeline: clean, sparsify, format
 */
export function prepareTranscriptForWhatToAnswer(
    turns: TranscriptTurn[],
    maxTurns: number = 12
): string {
    const cleaned = cleanTranscript(turns);
    const sparsified = sparsifyTranscript(cleaned, maxTurns);
    return formatTranscriptForLLM(sparsified);
}
