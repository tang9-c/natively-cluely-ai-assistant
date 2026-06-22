// electron/llm/IntentClassifier.ts
// Lightweight intent classification for "What should I say?"
// Micro step that runs before answer generation
//
// Two-tier classification:
//   1. Regex fast-path (< 1ms) for common patterns (English + Chinese)
//   2. Local multilingual SLM (mdeberta-v3 XNLI, ~80-150ms) for messy/ambiguous
//      speech. Label set is selected based on the input language to maximize
//      zero-shot accuracy.

import { getIntentClassifierProcessHost } from './IntentClassifierProcessHost';

export type ConversationIntent =
    // ===== Original 7 interview-centric intents (preserved for backward compat) =====
    | 'clarification'      // "Can you explain that?"
    | 'follow_up'          // "What happened next?"
    | 'deep_dive'          // "Tell me more about X"
    | 'behavioral'         // "Give me an example of..."
    | 'example_request'    // "Can you give a concrete example?"
    | 'summary_probe'      // "So to summarize..."
    | 'coding'             // "Write code for X" or implementation questions

    // ===== Shared / cross-mode intents =====
    | 'silence'            // No actionable content (filler, "ok", "yeah")
    | 'define_term'        // "What does X mean?" — explain a new term
    | 'advance_dialog'     // Suggest next step / follow-up

    // ===== Sales mode intents =====
    | 'handle_objection'   // Customer pushback ("太贵", "too expensive")
    | 'seize_signal'       // Strong buying intent ("准备签合同", "ready to move")
    | 'discovery_probe'    // Diagnostic question ("what's the challenge?")

    // ===== Recruiting mode (extras) =====
    | 'evaluate_answer'    // Candidate just answered; evaluate + probe
    | 'request_example'    // "Give me a concrete example"

    // ===== Team-meet mode intents =====
    | 'capture_action'     // Action item, ownership, deadline
    | 'capture_decision'   // Decision made
    | 'capture_risk'       // Blocker / risk / dependency
    | 'status_update'      // User called on for status

    // ===== Lecture mode intents =====
    | 'explain_concept'    // Instructor introduced a concept
    | 'render_formula'     // Formula / equation presented
    | 'answer_class_question' // Instructor asks the class

    // ===== Fallback =====
    | 'general';           // Default fallback

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

/**
 * Per-mode answer shape tables.
 *
 * Each mode has its own `Record<ConversationIntent, string>` for the intents
 * relevant to that mode. The general-mode table is the canonical "interview
 * candidate" set (preserved verbatim from the original INTENT_ANSWER_SHAPES
 * to keep `suggestionPromptAssembly.test.mjs` passing). Other modes override
 * the relevant intents with mode-specific guidance.
 *
 * Lookup rule (enforced by `getAnswerShapeForMode`): for a given mode and
 * intent, use the per-mode entry; if missing, fall back to the general table;
 * if still missing, return the general-fallback shape. This guarantees we
 * never throw on a missing shape.
 */
const GENERAL_ANSWER_SHAPES: Record<ConversationIntent, string> = {
    clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
    follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
    deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
    behavioral: 'Use a specific story only when grounded candidate/profile context exists. Without grounding, use the required no-context admission opener and keep any example illustrative, unnamed, modest, and qualitative.',
    example_request: 'Provide one concrete example from grounded context when available. Without grounding, label it as illustrative and avoid invented names, companies, dates, metrics, or first-person claims.',
    summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
    coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
    general: 'Respond naturally based on context. Keep it conversational and direct.',

    // Shared cross-mode defaults
    silence: 'Return exactly: "Nothing actionable right now." No filler, no commentary.',
    define_term: 'Bold the term; 1-2 sentence plain-language explanation. No dictionary format. Connect to a relevant point in context.',
    advance_dialog: 'Suggest exactly 3 short follow-up questions or one concrete next step.',

    // Sales / Recruiting / Team-meet / Lecture fall back to general unless overridden below.
    handle_objection: '',
    seize_signal: '',
    discovery_probe: '',
    evaluate_answer: '',
    request_example: '',
    capture_action: '',
    capture_decision: '',
    capture_risk: '',
    status_update: '',
    explain_concept: '',
    render_formula: '',
    answer_class_question: '',
};

const SALES_ANSWER_SHAPES: Partial<Record<ConversationIntent, string>> = {
    handle_objection: 'Acknowledge first ("That makes sense" / "I hear you"). Reframe with specifics. End with a forward-moving question. 2-3 sentences. No labels.',
    seize_signal: 'Propose a concrete next step with a specific time. Trade value for commitment. 1-2 sentences. Confident, no hedge.',
    discovery_probe: 'Ask 1-2 deep diagnostic questions, not surface. Example: "What challenge were you hoping to solve when you reached out?"',
    // Sales still benefits from interview-style handling of direct questions
    coding: GENERAL_ANSWER_SHAPES.coding,
    define_term: 'Define the product term; 1-2 sentences. Connect to customer use case.',
};

const RECRUITING_ANSWER_SHAPES: Partial<Record<ConversationIntent, string>> = {
    evaluate_answer: '[Observation 1-2 sentences about ownership/specificity/depth]. Ask them: "[exact probe question]". No labels, no preamble.',
    request_example: 'Push for concrete example with measurable outcome. E.g. "Walk me through specifically what you personally decided — not the team."',
    define_term: 'Define the role/jargon term in 1 sentence. Connect to the JD or scorecard criteria if available.',
};

const TEAM_MEET_ANSWER_SHAPES: Partial<Record<ConversationIntent, string>> = {
    capture_action: 'Output one line: 📋 **[Owner]** by **[Deadline]** to **[Task]**. If owner or deadline is missing, write "owner unclear" or "deadline unclear" — never guess.',
    capture_decision: 'Output one line: ✅ **[The decision made]**. Only emit when a decision is explicitly stated. No commentary.',
    capture_risk: 'Output one line: ⚠️ **[The risk/blocker]**. Mark dependencies, blockers, and at-risk items only. No "we should think about" hedging.',
    status_update: 'First-person status: current progress → next milestone → any blockers. 2-3 sentences. Direct, owns the work.',
    silence: 'Output: "Nothing to capture right now." — only when nothing actionable happened.',
};

const LECTURE_ANSWER_SHAPES: Partial<Record<ConversationIntent, string>> = {
    explain_concept: 'Bold the term, then 3-4 flowing peer-voice sentences with one real-world example. No dictionary format. No "What it is / Why it matters" labels.',
    render_formula: 'Render with LaTeX ($$...$$ block or $...$ inline). Quick inline variable definition. One intuition sentence that connects to something physical or concrete.',
    answer_class_question: '[ANSWER THIS]: "[1-2 sentence answer, confident]". If unsure, say "Likely X, but I would verify the Y part." Do not fabricate.',
    define_term: 'Bold the term; 2-3 sentences connecting it to a previously-defined concept or a real-world analogy. No formal definition.',
};

const MODE_ANSWER_SHAPES: Record<string, Partial<Record<ConversationIntent, string>>> = {
    'general': {},
    'looking-for-work': {},
    'sales': SALES_ANSWER_SHAPES,
    'recruiting': RECRUITING_ANSWER_SHAPES,
    'team-meet': TEAM_MEET_ANSWER_SHAPES,
    'lecture': LECTURE_ANSWER_SHAPES,
    'technical-interview': {},
};

/**
 * Resolve the answer shape string for a (mode, intent) pair with a 3-tier
 * fallback: per-mode entry → general table → hard-coded default. Never
 * returns undefined.
 */
export function getAnswerShapeForMode(
    modeTemplateType: string | null | undefined,
    intent: ConversationIntent,
): string {
    const modeKey = modeTemplateType ?? 'general';
    const perMode = MODE_ANSWER_SHAPES[modeKey];
    const fromPerMode = perMode?.[intent];
    if (fromPerMode) return fromPerMode;
    const fromGeneral = GENERAL_ANSWER_SHAPES[intent];
    if (fromGeneral) return fromGeneral;
    return GENERAL_ANSWER_SHAPES.general;
}

// ========================
// Zero-Shot SLM Classifier
// ========================

/**
 * Candidate labels for zero-shot classification (English).
 * Used when the input is detected as English and the active mode is in the
 * `general` family (`general`, `looking-for-work`, `recruiting`, `technical-interview`).
 */
const ZERO_SHOT_LABELS_EN_GENERAL: Record<string, ConversationIntent> = {
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
 * Per-mode English label sets for the SLM. The active mode narrows the
 * candidate set so zero-shot accuracy is higher than with one global table.
 * Any mode missing from this map falls back to `ZERO_SHOT_LABELS_EN_GENERAL`.
 */
const ZERO_SHOT_LABELS_EN_BY_MODE: Record<string, Record<string, ConversationIntent>> = {
    'sales': {
        'customer pushing back or raising a concern (price, value, competitor)': 'handle_objection',
        'customer showing strong buying intent or asking about next steps': 'seize_signal',
        'asking a deep diagnostic question to uncover the customer problem': 'discovery_probe',
        'no actionable content, just filler or acknowledgement': 'silence',
        'asking what a term or acronym means': 'define_term',
        'requesting a summary or next step': 'advance_dialog',
        'general conversation or question': 'general',
    },
    'recruiting': {
        'evaluating a candidate answer and probing deeper': 'evaluate_answer',
        'requesting a concrete example or instance from a candidate': 'request_example',
        'no actionable content, just filler or acknowledgement': 'silence',
        'asking what a term or acronym means': 'define_term',
        'general conversation or question': 'general',
    },
    'team-meet': {
        'an action item, ownership, or deadline being stated': 'capture_action',
        'a decision being made or confirmed': 'capture_decision',
        'a blocker, risk, or dependency being raised': 'capture_risk',
        'a team member giving a status update': 'status_update',
        'no actionable content, just filler or acknowledgement': 'silence',
        'requesting a summary or next step': 'advance_dialog',
        'general conversation or question': 'general',
    },
    'lecture': {
        'a new concept or term being introduced': 'explain_concept',
        'a formula, equation, or theorem being presented': 'render_formula',
        'the instructor asking the class a question': 'answer_class_question',
        'no actionable content, just filler or acknowledgement': 'silence',
        'asking what a term or acronym means': 'define_term',
        'requesting a summary or next step': 'advance_dialog',
        'general conversation or question': 'general',
    },
};

/**
 * Candidate labels for zero-shot classification (Chinese).
 * Used when the input is detected as Chinese. The multilingual XNLI model
 * (mdeberta-v3-base-xnli-multilingual-nli-2mil7) understands Chinese labels
 * natively, so we can ask the model in the same language as the user.
 */
const ZERO_SHOT_LABELS_ZH_GENERAL: Record<string, ConversationIntent> = {
    '请求澄清或解释说明': 'clarification',
    '询问接下来发生什么或追问': 'follow_up',
    '请求更详细或更深入的解释': 'deep_dive',
    '询问个人经历或行为例子': 'behavioral',
    '请求具体例子': 'example_request',
    '总结或确认理解': 'summary_probe',
    '询问代码、编程或实现': 'coding',
    '一般性对话或问题': 'general',
};

const ZERO_SHOT_LABELS_ZH_BY_MODE: Record<string, Record<string, ConversationIntent>> = {
    'sales': {
        '客户提出价格、价值或竞品方面的异议': 'handle_objection',
        '客户表达明确的购买意向或询问下一步': 'seize_signal',
        '提出深度诊断问题以挖掘客户痛点': 'discovery_probe',
        '无可行动内容,只是寒暄或确认': 'silence',
        '询问某个术语或缩写的含义': 'define_term',
        '请求总结或下一步': 'advance_dialog',
        '一般性对话或问题': 'general',
    },
    'recruiting': {
        '评估候选人回答并深入追问': 'evaluate_answer',
        '要求候选人给出具体例子': 'request_example',
        '无可行动内容,只是寒暄或确认': 'silence',
        '询问某个术语或缩写的含义': 'define_term',
        '一般性对话或问题': 'general',
    },
    'team-meet': {
        '正在陈述行动项、负责人或截止时间': 'capture_action',
        '正在做出或确认决策': 'capture_decision',
        '正在提出阻塞、风险或依赖': 'capture_risk',
        '团队成员正在做状态汇报': 'status_update',
        '无可行动内容,只是寒暄或确认': 'silence',
        '请求总结或下一步': 'advance_dialog',
        '一般性对话或问题': 'general',
    },
    'lecture': {
        '正在引入新的概念或术语': 'explain_concept',
        '正在展示公式、方程或定理': 'render_formula',
        '讲师正在向全班提问': 'answer_class_question',
        '无可行动内容,只是寒暄或确认': 'silence',
        '询问某个术语或缩写的含义': 'define_term',
        '请求总结或下一步': 'advance_dialog',
        '一般性对话或问题': 'general',
    },
};

/**
 * Resolve the SLM label map for a given mode and language. Falls back to
 * the general table if the mode has no specialized labels. Returns the
 * `Record<label_string, intent>` ready to pass to the pipeline as `candidate_labels`.
 */
function getLabelMapForMode(
    modeTemplateType: string | null | undefined,
    isChinese: boolean,
): Record<string, ConversationIntent> {
    const modeKey = modeTemplateType ?? 'general';
    const byMode = isChinese
        ? ZERO_SHOT_LABELS_ZH_BY_MODE[modeKey]
        : ZERO_SHOT_LABELS_EN_BY_MODE[modeKey];
    if (byMode) return byMode;
    return isChinese ? ZERO_SHOT_LABELS_ZH_GENERAL : ZERO_SHOT_LABELS_EN_GENERAL;
}

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

// ========================
// Regex Fast-Path
// ========================

/**
 * Pattern-based intent detection (fast, no model call).
 *
 * Dispatches to a per-mode regex set when `modeTemplateType` is given, so
 * non-interview modes (sales, team-meet, lecture, etc.) get the
 * mode-appropriate classifier instead of the interview-only one. Falls back
 * to the interview regex ONLY for interview-family modes; for non-interview
 * modes, if no specialized regex matches we return null (so the SLM can
 * take over) — this prevents cross-mode contamination like an interview
 * `behavioral` regex firing in `sales` mode.
 */
export function detectIntentByPattern(
    lastInterviewerTurn: string,
    modeTemplateType?: string | null,
): IntentResult | null {
    const text = lastInterviewerTurn.toLowerCase().trim();
    const mode = modeTemplateType ?? 'general';

    // Interview-family modes: 7-intent regex (default behaviour, preserved).
    if (isModeInterviewFamily(mode)) {
        return detectInterviewIntentByPattern(text);
    }

    // Non-interview modes: specialized regex per mode. Falls through to null
    // (SLM territory) if no specialized pattern matches.
    switch (mode) {
        case 'sales':
            return detectSalesIntentByPattern(text);
        case 'team-meet':
            return detectTeamMeetIntentByPattern(text);
        case 'lecture':
            return detectLectureIntentByPattern(text);
        case 'recruiting':
            // Recruiting has only one extra regex (`request_example`); for
            // the rest it falls back to the interview family. So unlike
            // pure-non-interview modes, we DO fall through here.
            return detectRecruitingIntentByPattern(text) ?? detectInterviewIntentByPattern(text);
        default:
            // Unknown mode — be conservative, use the interview family.
            return detectInterviewIntentByPattern(text);
    }
}

/**
 * Returns true if `modeTemplateType` is one of the interview-style modes
 * that share the 7-intent regex set. Used to keep the existing
 * `detectIntentByPattern` behaviour for the interview family while letting
 * other modes get specialized regex tables.
 *
 * Note: `recruiting` is intentionally EXCLUDED from this family so that
 * its specialized `detectRecruitingIntentByPattern` (with the
 * `request_example` regex) gets a chance to fire before falling through to
 * the interview family. The dispatcher below special-cases recruiting.
 */
export function isModeInterviewFamily(modeTemplateType: string | null | undefined): boolean {
    const m = modeTemplateType ?? 'general';
    return m === 'general'
        || m === 'looking-for-work'
        || m === 'technical-interview';
}

/**
 * Returns the answer shape for a (mode, intent) pair with a 3-tier fallback:
 * per-mode entry → general table → hard-coded default. Public so callers
 * outside the file (e.g. tests) can introspect shapes without going through
 * the classifier.
 */
export function getShapeForMode(
    modeTemplateType: string | null | undefined,
    intent: ConversationIntent,
): string {
    return getAnswerShapeForMode(modeTemplateType, intent);
}

/**
 * Original 7-intent regex (English + Chinese), used as the default for
 * the interview family and `general` mode. Exposed for unit tests and for
 * the dispatcher above.
 */
function detectInterviewIntentByPattern(text: string): IntentResult | null {
    // Clarification patterns (English + Chinese)
    // NOTE: "详细讲" is intentionally NOT here — it's the deep_dive cue. Keep
    // this list to short follow-up clarifications only.
    if (/(can you explain|what do you mean|clarify|could you elaborate on that specific)/i.test(text)
        || /(能解释|什么意思|怎么讲|具体说|澄清|说明下|解释一下|怎么理解)/.test(text)) {
        return { intent: 'clarification', confidence: 0.9, answerShape: getAnswerShapeForMode('general', 'clarification') };
    }

    // Follow-up patterns (English + Chinese)
    if (/(what happened|then what|and after that|what.s next|how did that go)/i.test(text)
        || /(后来呢|后来怎样|然后呢|接下来|后来如何|然后怎样|之后呢|结果呢|接下来呢|后来怎么了)/.test(text)) {
        return { intent: 'follow_up', confidence: 0.85, answerShape: getAnswerShapeForMode('general', 'follow_up') };
    }

    // Deep dive patterns (English + Chinese)
    if (/(tell me more|dive deeper|explain further|walk me through|how does that work)/i.test(text)
        || /(详细讲|深入讲|展开讲|讲详细点|具体讲讲|解释清楚|讲清楚|细说|细讲|多说一些|再多说|再讲讲|深入解释)/.test(text)) {
        return { intent: 'deep_dive', confidence: 0.85, answerShape: getAnswerShapeForMode('general', 'deep_dive') };
    }

    // Behavioral patterns (English + Chinese)
    if (/(give me an example|tell me about a time|describe a situation|when have you|share an experience)/i.test(text)
        || /(举个例子|讲个例子|举一个例子|讲讲你以前|讲讲你当时|你曾经|描述一下当时|讲讲一次|讲讲你过去|讲讲你的经历|有没有类似的例子|讲个故事)/.test(text)) {
        return { intent: 'behavioral', confidence: 0.9, answerShape: getAnswerShapeForMode('general', 'behavioral') };
    }

    // Example request patterns (English + Chinese)
    if (/(for example|concrete example|specific instance|like what|such as)/i.test(text)
        || /(比如|例如|具体例子|举个实例|像什么|类似的|像这样的|什么例子|具体说一说|讲个具体例子)/.test(text)) {
        return { intent: 'example_request', confidence: 0.85, answerShape: getAnswerShapeForMode('general', 'example_request') };
    }

    // Summary probe patterns (English + Chinese)
    if (/(so to summarize|in summary|so basically|so you.re saying|let me make sure)/i.test(text)
        || /(总结一下|概括一下|简单总结|简要说一下|总体来说|总的来说|综上所述|归纳一下|总结下|总结总结)/.test(text)) {
        return { intent: 'summary_probe', confidence: 0.85, answerShape: getAnswerShapeForMode('general', 'summary_probe') };
    }

    // Coding patterns (Broad detection for programming/implementation) (English + Chinese)
    if (/(write code|program|implement|function for|algorithm|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|optimize|refactor|best practice for .* code|utility method|component for|logic for)/i.test(text)
        || /(写代码|写一下代码|实现一下|解这道题|解一下|代码怎么写|这个算法|怎么实现|实现这个|怎么写|如何实现|用.*实现|.*的代码|调试|优化|重构|怎么优化|怎么调试)/.test(text)) {
        return { intent: 'coding', confidence: 0.9, answerShape: getAnswerShapeForMode('general', 'coding') };
    }

    return null; // No clear pattern detected
}

// ========================
// Per-Mode Regex Sub-Dispatchers
// ========================

/**
 * Sales mode regex (English + Chinese). Order matters: more specific intents
 * are tested first so they win on overlapping inputs.
 */
function detectSalesIntentByPattern(text: string): IntentResult | null {
    // 1. Buying signal — strongest purchase intent
    if (/(ready to move|ready to sign|send (over )?the contract|send (over )?a (proposal|quote)|let'?s move forward|next steps|finalize|sign the deal|legal review|procurement|when can we start|let'?s get started|let'?s (kick ?off|schedule))/i.test(text)
        || /(准备签|准备推进|准备敲定|准备开始|发合同|发报价|法务审核|采购流程|下一步怎么走|下一步是|敲定|签合同|推进到|往下走|启动)/.test(text)) {
        return { intent: 'seize_signal', confidence: 0.95, answerShape: getAnswerShapeForMode('sales', 'seize_signal') };
    }
    // 2. Objection — pushback on price, value, competitor
    if (/(too expensive|too pricey|too high|can'?t afford|out of (our|my) budget|not in the budget|cheaper (option|alternative)|discount|price is|reduce the price|competitor|alternative (vendor|provider|tool|product)|why (not use|choose) .* instead|switch from|already using|heard of|what about .* instead|do better on (price|cost)|can you (do better|lower|reduce))/i.test(text)
        || /(太贵|价格高|价格太高|超出预算|预算不够|预算不足|负担不起|能不能便宜|便宜点|打个折|有折扣吗|竞品|竞争对手|别家|其他供应商|用.*也行|听说|为什么不用|换.*行不行|考虑一下|对比一下|已经在用)/.test(text)) {
        return { intent: 'handle_objection', confidence: 0.92, answerShape: getAnswerShapeForMode('sales', 'handle_objection') };
    }
    // 3. Discovery probe — diagnostic, surface the underlying problem
    if (/(what'?s the (biggest |main |primary )?(challenge|problem)|what are you trying to (solve|achieve)|pain point|what'?s frustrating|what would need to be true|how (are|do) you (handle|currently do) .* today|walk me through .* (process|workflow)|what'?s (driving|prompting) .* (look|search|reach) (for|out)|what does .* (process|workflow|setup) look like|biggest challenge|workflow .* look like|current (process|workflow|setup))/i.test(text)
        || /(有什么挑战|什么问题|痛点是什么|想解决什么|想达到什么|当前的流程|现在怎么.*的|困扰|为什么要|什么驱动|考察什么|在选什么|需要什么|关注什么|看重什么|遇到什么|流程是怎样的)/.test(text)) {
        return { intent: 'discovery_probe', confidence: 0.85, answerShape: getAnswerShapeForMode('sales', 'discovery_probe') };
    }
    // 4. ROI / value question
    if (/(ROI|return on investment|how (do you|will you) (save|generate) .* (money|time)|payback period|prove the (value|ROI)|what'?s the (value|business case)|how (quickly|fast) (do|will) (we|i) see (results|returns))/i.test(text)
        || /(投资回报|回报率|商业价值|多久回本|怎么衡量效果|效果怎么样|能带来什么|能省多少)/.test(text)) {
        return { intent: 'discovery_probe', confidence: 0.85, answerShape: getAnswerShapeForMode('sales', 'discovery_probe') };
    }
    return null;
}

/**
 * Team-meet mode regex (English + Chinese). Captures action items, decisions,
 * risks, and status updates as discrete intents.
 */
function detectTeamMeetIntentByPattern(text: string): IntentResult | null {
    // 1. Action item — ownership + commitment
    if (/(i'?ll (do|send|handle|own|take|follow up|write|ship|PR|merge)|I'?m gonna|let me .* by|action item|to-do|assigned to|owner is|@.* (please )?(do|own|handle)|I can have .* by|by (monday|tuesday|wednesday|thursday|friday|EOD|EOW|next week))/i.test(text)
        || /(我来做|我来发|我来负责|我来处理|我跟进|我写|我来 PR|我提|我合|交给我|我包了|分配给|让.*来|让.*做|行动项|待办|跟进项|截止|周五前|周一前|下周三前|今天内|尽快|尽快.*交|完成|上线|交付)/.test(text)) {
        return { intent: 'capture_action', confidence: 0.92, answerShape: getAnswerShapeForMode('team-meet', 'capture_action') };
    }
    // 2. Decision — explicit "we decided"
    if (/(we decided|let'?s go with|going with|final decision|approved|signed off|greenlit|consensus is|the team agreed|we'?re going to use|ship it|merged|locked in|confirmed we)/i.test(text)
        || /(决定(了|用|走|采用)?|就选|就用|就上|定了|通过了|批准了|确认.*用|最终决定|定下来了|达成一致|大家同意|定了.*方案|采用)/.test(text)) {
        return { intent: 'capture_decision', confidence: 0.9, answerShape: getAnswerShapeForMode('team-meet', 'capture_decision') };
    }
    // 3. Risk / blocker
    if (/(blocker|blocked (by|on)|stuck (on|at)|risk|at risk|slipping|will miss|behind schedule|dependency (on|blocking)|waiting on|depends on|not gonna make|impacting timeline|regression)/i.test(text)
        || /(阻塞|被卡|卡住|卡在|风险|延期|推迟|完不成|赶不上|影响进度|依赖|等.*完成|要看.*才能|被.*阻塞|短板|坑|出了点问题)/.test(text)) {
        return { intent: 'capture_risk', confidence: 0.88, answerShape: getAnswerShapeForMode('team-meet', 'capture_risk') };
    }
    // 4. Status update — direct progress report
    if (/(where (are we|do we stand)|status update|what'?s the status|where'?s .* (at|on)|how'?s .* going|any progress on|update on|progress on|current status|where are we on)/i.test(text)
        || /(进度|状态|现在.*怎样|现在.*如何|.*进展|到哪了|卡在哪|进展如何|进度怎么样|谁负责|负责人是谁|什么时候.*能|预计什么时候|截止日期|时间线|预计.*交付|ETA)/.test(text)) {
        return { intent: 'status_update', confidence: 0.85, answerShape: getAnswerShapeForMode('team-meet', 'status_update') };
    }
    return null;
}

/**
 * Lecture mode regex (English + Chinese). Detects concept introduction,
 * formula rendering, and class questions.
 */
function detectLectureIntentByPattern(text: string): IntentResult | null {
    // 1. Concept introduction
    if (/(this is (called|known as)|the (concept|principle|idea) of|by definition|definition of|introducing|let'?s define|we define|theorem of|principle of|the (term|word) .* means|recall that .* (means|is))/i.test(text)
        || /(这个叫|叫做|所谓的|定义为|引入|概念是|这个概念|.*的概念|术语|.*的意思是|.*的含义|.*的定义|定理|原理|原则)/.test(text)) {
        return { intent: 'explain_concept', confidence: 0.9, answerShape: getAnswerShapeForMode('lecture', 'explain_concept') };
    }
    // 2. Formula / equation / theorem
    if (/(\$.*=|\\\(|\)|equation|formula|theorem (of|says)|lemma|corollary|proof|derivation|derive|integral|sum of|product of|limit of|matrix|vector)/i.test(text)
        || /(公式|方程|定理|引理|推论|证明|推导|积分|求和|连乘|极限|矩阵|向量|等于|=|式子|表达式)/.test(text)) {
        return { intent: 'render_formula', confidence: 0.9, answerShape: getAnswerShapeForMode('lecture', 'render_formula') };
    }
    // 3. Class question
    if (/(anyone know|who can tell|what is the answer|does anyone|can anyone (tell|explain)|raise (your )?hand if|class, .* \?|any volunteers)/i.test(text)
        || /(谁知道|谁来答|有人知道|有没有人|谁能.*说一下|举手|哪位同学|请回答|答案是什么|怎么算|怎么解)/.test(text)) {
        return { intent: 'answer_class_question', confidence: 0.85, answerShape: getAnswerShapeForMode('lecture', 'answer_class_question') };
    }
    return null;
}

/**
 * Recruiting mode regex — extends the interview family with the interviewer
 * perspective. Falls back to the interview regex for behavioral / follow-up /
 * clarification signals.
 */
function detectRecruitingIntentByPattern(text: string): IntentResult | null {
    // Request example from candidate
    if (/(can you give (me )?a (specific )?example|walk me through (a specific|specifically)|do you have an example|a concrete example|for instance|what'?s a time when|how did you (handle|approach|decide))/i.test(text)
        || /(举一个.{0,5}例子|讲一个.{0,5}例子|举.{0,3}例子|讲.{0,3}例子|具体例子|具体说说|能不能举例|你能不能.*举|讲讲你当时怎么|你怎么处理的|怎么决定的|讲个.{0,3}例子|给我一个例子)/.test(text)) {
        return { intent: 'request_example', confidence: 0.88, answerShape: getAnswerShapeForMode('recruiting', 'request_example') };
    }
    return null; // Fall through to interview family
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
    assistantMessageCount: number,
    modeTemplateType?: string | null,
): IntentResult {
    // If we've given multiple answers and interviewer is probing, likely follow_up
    if (assistantMessageCount >= 2) {
        // Check if interviewer is drilling down
        const lines = recentTranscript.split('\n');
        const interviewerLines = lines.filter(l => l.includes('[INTERVIEWER'));

        // Short interviewer prompts after long exchanges = follow-up probe
        const lastInterviewerLine = interviewerLines[interviewerLines.length - 1] || '';
        if (lastInterviewerLine.length < 50 && assistantMessageCount >= 2) {
            return { intent: 'follow_up', confidence: 0.7, answerShape: getAnswerShapeForMode(modeTemplateType, 'follow_up') };
        }
    }

    // Default to general
    return { intent: 'general', confidence: 0.5, answerShape: getAnswerShapeForMode(modeTemplateType, 'general') };
}

// ========================
// Public API
// ========================

/**
 * Main intent classification function (async)
 *
 * Three-tier priority:
 *   1. Regex fast-path (< 1ms, high confidence) — mode-aware
 *   2. Zero-shot SLM fallback (~80-150ms, medium-high confidence) — narrowed
 *      per-mode label set
 *   3. Context-based heuristic (0ms, low confidence)
 *
 * `modeTemplateType` is the kebab-case `ModesManager.ModeTemplateType`. When
 * omitted or unknown, behavior is identical to the previous
 * mode-agnostic version (regex + SLM use the general label set).
 */
export async function classifyIntent(
    lastInterviewerTurn: string | null,
    recentTranscript: string,
    assistantMessageCount: number,
    modeTemplateType?: string | null,
): Promise<IntentResult> {
    // Tier 1: Try regex-based first (high confidence, instant)
    if (lastInterviewerTurn) {
        const patternResult = detectIntentByPattern(lastInterviewerTurn, modeTemplateType);
        if (patternResult) {
            return patternResult;
        }

        // Tier 2: Try zero-shot SLM (if regex didn't match)
        if (lastInterviewerTurn.trim().length > 5) {
            const slmResult = await getIntentClassifierProcessHost().classify(lastInterviewerTurn, modeTemplateType);
            if (slmResult) {
                return slmResult;
            }
        }
    }

    // Tier 3: Fall back to context-based heuristic
    return detectIntentByContext(recentTranscript, assistantMessageCount, modeTemplateType);
}

/**
 * Get answer shape guidance for prompt injection. Backward-compatible
 * shim: when called without a mode (e.g. from legacy tests or callers that
 * only know the intent), it returns the general table entry. New callers
 * should prefer `getAnswerShapeForMode` to get mode-specific shape strings.
 */
export function getAnswerShapeGuidance(intent: ConversationIntent): string {
    return getAnswerShapeForMode('general', intent);
}

/**
 * Pre-warm the SLM model in background.
 * Call this during app initialization to avoid cold-start on first classification.
 */
export function warmupIntentClassifier(): void {
    getIntentClassifierProcessHost().warmup();
}
