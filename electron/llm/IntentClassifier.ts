// electron/llm/IntentClassifier.ts
// Lightweight intent classification for "What should I say?"
// Micro step that runs before answer generation
//
// Two-tier classification:
//   1. Regex fast-path (< 1ms) for common patterns (English + Chinese)
//   2. Local multilingual SLM (mdeberta-v3 XNLI, ~80-150ms) for messy/ambiguous
//      speech. Label set is selected based on the input language to maximize
//      zero-shot accuracy.

import path from 'path';
import { app } from 'electron';

export type ConversationIntent =
    | 'clarification'      // "Can you explain that?"
    | 'follow_up'          // "What happened next?"
    | 'deep_dive'          // "Tell me more about X"
    | 'behavioral'         // "Give me an example of..."
    | 'example_request'    // "Can you give a concrete example?"
    | 'summary_probe'      // "So to summarize..."
    | 'coding'             // "Write code for X" or implementation questions
    | 'general';           // Default fallback

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

/**
 * Answer shapes mapped to intents
 * This controls HOW the answer is structured, not just WHAT it says
 */
const INTENT_ANSWER_SHAPES: Record<ConversationIntent, string> = {
    clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
    follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
    deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
    behavioral: 'Use a specific story only when grounded candidate/profile context exists. Without grounding, use the required no-context admission opener and keep any example illustrative, unnamed, modest, and qualitative.',
    example_request: 'Provide one concrete example from grounded context when available. Without grounding, label it as illustrative and avoid invented names, companies, dates, metrics, or first-person claims.',
    summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
    coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
    general: 'Respond naturally based on context. Keep it conversational and direct.'
};

// ========================
// Zero-Shot SLM Classifier
// ========================

/**
 * Candidate labels for zero-shot classification (English).
 * Used when the input is detected as English.
 */
const ZERO_SHOT_LABELS_EN: Record<string, ConversationIntent> = {
    'asking for clarification or explanation': 'clarification',
    'asking about what happened next or follow-up': 'follow_up',
    'requesting more detail or deeper explanation': 'deep_dive',
    'asking for a personal experience or behavioral example': 'behavioral',
    'requesting a concrete example or instance': 'example_request',
    'summarizing or confirming understanding': 'summary_probe',
    'asking about code, programming, or implementation': 'coding',
    'general conversation or question': 'general',
};

/**
 * Candidate labels for zero-shot classification (Chinese).
 * Used when the input is detected as Chinese. The multilingual XNLI model
 * (mdeberta-v3-base-xnli-multilingual-nli-2mil7) understands Chinese labels
 * natively, so we can ask the model in the same language as the user.
 */
const ZERO_SHOT_LABELS_ZH: Record<string, ConversationIntent> = {
    '请求澄清或解释说明': 'clarification',
    '询问接下来发生什么或追问': 'follow_up',
    '请求更详细或更深入的解释': 'deep_dive',
    '询问个人经历或行为例子': 'behavioral',
    '请求具体例子': 'example_request',
    '总结或确认理解': 'summary_probe',
    '询问代码、编程或实现': 'coding',
    '一般性对话或问题': 'general',
};

/**
 * Heuristic: detect whether the input text is primarily Chinese.
 *
 * Returns true when CJK Unified Ideographs (U+4E00..U+9FFF) make up at
 * least `threshold` of the *meaningful* content — defined as the original
 * text with ASCII whitespace + common punctuation stripped out. This avoids
 * the over-permissive `cjk.length >= 1` heuristic that would mislabel
 * mixed inputs like "OK 你好 yes" as Chinese on the strength of a single
 * CJK character.
 *
 * The threshold is exposed for tests and future tuning; production callers
 * should use the default (0.3).
 */
export function isPrimarilyChinese(text: string, threshold = 0.3): boolean {
    if (!text) return false;
    const cjkChars = text.match(/[一-鿿]/g);
    if (!cjkChars || cjkChars.length === 0) return false;
    // Strip whitespace, ASCII punctuation, and fullwidth punctuation so they
    // don't dilute the CJK ratio.
    const stripped = text.replace(/[\s　-〿.,!?;:'"()\[\]{}<>—\-]/g, '');
    if (stripped.length === 0) return false;
    return cjkChars.length / stripped.length >= threshold;
}

/** Minimum confidence from the SLM to trust its classification */
const SLM_CONFIDENCE_THRESHOLD = 0.35;

/**
 * Singleton lazy-loaded zero-shot classifier using @huggingface/transformers
 */
class ZeroShotClassifier {
    private static instance: ZeroShotClassifier | null = null;
    private pipe: any = null;
    private loadingPromise: Promise<void> | null = null;
    private loadFailed = false;

    private constructor() {}

    static getInstance(): ZeroShotClassifier {
        if (!ZeroShotClassifier.instance) {
            ZeroShotClassifier.instance = new ZeroShotClassifier();
        }
        return ZeroShotClassifier.instance;
    }

    /**
     * Lazy-load the zero-shot classification model.
     * Uses Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7 — multilingual NLI,
     * supports Chinese / English / 100+ languages. ~280MB, ~80-150ms inference.
     */
    private async ensureLoaded(): Promise<void> {
        if (this.pipe) return;
        if (this.loadFailed) return;

        if (this.loadingPromise) {
            await this.loadingPromise;
            return;
        }

        this.loadingPromise = (async () => {
            try {
                // Bypass TypeScript converting import() to require() for ESM packages
                const { pipeline, env } = await new Function("return import('@huggingface/transformers')")();

                // Use userData/models as cache; allow remote download on first use
                env.allowRemoteModels = true;
                env.cacheDir = path.join(app.getPath('userData'), 'models');
                env.remoteHost = (process.env.HF_ENDPOINT || 'https://modelscope.cn/models').replace(/\/$/, '') + '/';

                console.log('[IntentClassifier] Loading zero-shot classifier (mdeberta-v3-base-xnli-multilingual-nli-2mil7)...');
                this.pipe = await pipeline(
                    'zero-shot-classification',
                    'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7',
                    { local_files_only: false }
                );
                console.log('[IntentClassifier] Zero-shot classifier loaded successfully.');
            } catch (e) {
                console.warn('[IntentClassifier] Failed to load zero-shot model, regex-only fallback:', e);
                this.loadFailed = true;
                this.pipe = null;
            }
        })();

        try {
            await this.loadingPromise;
        } catch {
            this.loadingPromise = null;
        }
    }

    /**
     * Classify text using the zero-shot model.
     * Picks the label set (English or Chinese) based on the input language.
     * Returns null if the model isn't loaded or classification fails.
     */
    async classify(text: string): Promise<IntentResult | null> {
        await this.ensureLoaded();
        if (!this.pipe) return null;

        try {
            // Pick the label set that matches the input language. The
            // multilingual XNLI model understands both, but matching the
            // candidate labels to the input language yields noticeably
            // higher zero-shot accuracy.
            const labelMap = isPrimarilyChinese(text) ? ZERO_SHOT_LABELS_ZH : ZERO_SHOT_LABELS_EN;
            const labelKeys = Object.keys(labelMap);

            const result = await this.pipe(text, labelKeys, {
                multi_label: false,
            });

            // result has { labels: string[], scores: number[] }
            const topLabel = result.labels[0];
            const topScore = result.scores[0];

            if (topScore < SLM_CONFIDENCE_THRESHOLD) {
                return null; // Not confident enough
            }

            const intent = labelMap[topLabel] || 'general';
            console.log(`[IntentClassifier] SLM classified`, {
                intent,
                confidence: topScore,
                textLength: text.length,
                labelSet: isPrimarilyChinese(text) ? 'zh' : 'en',
            });

            return {
                intent,
                confidence: topScore,
                answerShape: INTENT_ANSWER_SHAPES[intent],
            };
        } catch (e) {
            console.warn('[IntentClassifier] SLM classification error:', e);
            return null;
        }
    }

    /**
     * Warm up the model in background (non-blocking).
     * Call this early in app lifecycle to avoid cold-start latency.
     */
    warmup(): void {
        this.ensureLoaded().catch(() => {});
    }
}

// ========================
// Regex Fast-Path
// ========================

/**
 * Pattern-based intent detection (fast, no model call)
 * For common patterns this is sufficient
 */
export function detectIntentByPattern(lastInterviewerTurn: string): IntentResult | null {
    const text = lastInterviewerTurn.toLowerCase().trim();

    // Clarification patterns (English + Chinese)
    // NOTE: "详细讲" is intentionally NOT here — it's the deep_dive cue. Keep
    // this list to short follow-up clarifications only.
    if (/(can you explain|what do you mean|clarify|could you elaborate on that specific)/i.test(text)
        || /(能解释|什么意思|怎么讲|具体说|澄清|说明下|解释一下|怎么理解)/.test(text)) {
        return { intent: 'clarification', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.clarification };
    }

    // Follow-up patterns (English + Chinese)
    if (/(what happened|then what|and after that|what.s next|how did that go)/i.test(text)
        || /(后来呢|后来怎样|然后呢|接下来|后来如何|然后怎样|之后呢|结果呢|接下来呢|后来怎么了)/.test(text)) {
        return { intent: 'follow_up', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.follow_up };
    }

    // Deep dive patterns (English + Chinese)
    if (/(tell me more|dive deeper|explain further|walk me through|how does that work)/i.test(text)
        || /(详细讲|深入讲|展开讲|讲详细点|具体讲讲|解释清楚|讲清楚|细说|细讲|多说一些|再多说|再讲讲|深入解释)/.test(text)) {
        return { intent: 'deep_dive', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.deep_dive };
    }

    // Behavioral patterns (English + Chinese)
    if (/(give me an example|tell me about a time|describe a situation|when have you|share an experience)/i.test(text)
        || /(举个例子|讲个例子|举一个例子|讲讲你以前|讲讲你当时|你曾经|描述一下当时|讲讲一次|讲讲你过去|讲讲你的经历|有没有类似的例子|讲个故事)/.test(text)) {
        return { intent: 'behavioral', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.behavioral };
    }

    // Example request patterns (English + Chinese)
    if (/(for example|concrete example|specific instance|like what|such as)/i.test(text)
        || /(比如|例如|具体例子|举个实例|像什么|类似的|像这样的|什么例子|具体说一说|讲个具体例子)/.test(text)) {
        return { intent: 'example_request', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.example_request };
    }

    // Summary probe patterns (English + Chinese)
    if (/(so to summarize|in summary|so basically|so you.re saying|let me make sure)/i.test(text)
        || /(总结一下|概括一下|简单总结|简要说一下|总体来说|总的来说|综上所述|归纳一下|总结下|总结总结)/.test(text)) {
        return { intent: 'summary_probe', confidence: 0.85, answerShape: INTENT_ANSWER_SHAPES.summary_probe };
    }

    // Coding patterns (Broad detection for programming/implementation) (English + Chinese)
    if (/(write code|program|implement|function for|algorithm|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|optimize|refactor|best practice for .* code|utility method|component for|logic for)/i.test(text)
        || /(写代码|写一下代码|实现一下|解这道题|解一下|代码怎么写|这个算法|怎么实现|实现这个|怎么写|如何实现|用.*实现|.*的代码|调试|优化|重构|怎么优化|怎么调试)/.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: INTENT_ANSWER_SHAPES.coding };
    }

    return null; // No clear pattern detected
}

// ========================
// Context-Aware Fallback
// ========================

/**
 * Context-aware intent detection
 * Looks at conversation flow, not just the last turn
 */
function detectIntentByContext(
    recentTranscript: string,
    assistantMessageCount: number
): IntentResult {
    // If we've given multiple answers and interviewer is probing, likely follow_up
    if (assistantMessageCount >= 2) {
        // Check if interviewer is drilling down
        const lines = recentTranscript.split('\n');
        const interviewerLines = lines.filter(l => l.includes('[INTERVIEWER'));

        // Short interviewer prompts after long exchanges = follow-up probe
        const lastInterviewerLine = interviewerLines[interviewerLines.length - 1] || '';
        if (lastInterviewerLine.length < 50 && assistantMessageCount >= 2) {
            return { intent: 'follow_up', confidence: 0.7, answerShape: INTENT_ANSWER_SHAPES.follow_up };
        }
    }

    // Default to general
    return { intent: 'general', confidence: 0.5, answerShape: INTENT_ANSWER_SHAPES.general };
}

// ========================
// Public API
// ========================

/**
 * Main intent classification function (async)
 *
 * Three-tier priority:
 *   1. Regex fast-path (< 1ms, high confidence)
 *   2. Zero-shot SLM fallback (~10-50ms, medium-high confidence)
 *   3. Context-based heuristic (0ms, low confidence)
 */
export async function classifyIntent(
    lastInterviewerTurn: string | null,
    recentTranscript: string,
    assistantMessageCount: number
): Promise<IntentResult> {
    // Tier 1: Try regex-based first (high confidence, instant)
    if (lastInterviewerTurn) {
        const patternResult = detectIntentByPattern(lastInterviewerTurn);
        if (patternResult) {
            return patternResult;
        }

        // Tier 2: Try zero-shot SLM (if regex didn't match)
        if (lastInterviewerTurn.trim().length > 5) {
            const slmResult = await ZeroShotClassifier.getInstance().classify(lastInterviewerTurn);
            if (slmResult) {
                return slmResult;
            }
        }
    }

    // Tier 3: Fall back to context-based heuristic
    return detectIntentByContext(recentTranscript, assistantMessageCount);
}

/**
 * Get answer shape guidance for prompt injection
 */
export function getAnswerShapeGuidance(intent: ConversationIntent): string {
    return INTENT_ANSWER_SHAPES[intent];
}

/**
 * Pre-warm the SLM model in background.
 * Call this during app initialization to avoid cold-start on first classification.
 */
export function warmupIntentClassifier(): void {
    ZeroShotClassifier.getInstance().warmup();
}
