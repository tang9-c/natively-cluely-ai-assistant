// Shared definitions for mode-aware intent classification.
//
// This module must stay free of Electron and native model imports so it can be
// loaded safely by both the Electron main process and the isolated classifier
// child process.

export type ConversationIntent =
    // ===== Original 7 interview-centric intents (preserved for backward compat) =====
    | 'clarification'
    | 'follow_up'
    | 'deep_dive'
    | 'behavioral'
    | 'example_request'
    | 'summary_probe'
    | 'coding'

    // ===== Shared / cross-mode intents =====
    | 'silence'
    | 'define_term'
    | 'advance_dialog'

    // ===== Sales mode intents =====
    | 'handle_objection'
    | 'seize_signal'
    | 'discovery_probe'

    // ===== Recruiting mode (extras) =====
    | 'evaluate_answer'
    | 'request_example'

    // ===== Team-meet mode intents =====
    | 'capture_action'
    | 'capture_decision'
    | 'capture_risk'
    | 'status_update'

    // ===== Lecture mode intents =====
    | 'explain_concept'
    | 'render_formula'
    | 'answer_class_question'

    // ===== FDE mode intents =====
    | 'fde_discovery'
    | 'fde_integration'
    | 'fde_security'
    | 'fde_risk'
    | 'fde_success'
    | 'fde_next_step'

    // ===== Fallback =====
    | 'general';

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

const GENERAL_ANSWER_SHAPES: Record<ConversationIntent, string> = {
    clarification: 'Give a direct, focused 1-2 sentence clarification. No setup, no context-setting.',
    follow_up: 'Continue the narrative naturally. 1-2 sentences. No recap of what was already said.',
    deep_dive: 'Provide a structured but concise explanation. Use concrete specifics, not abstract concepts.',
    behavioral: 'Use a specific story only when grounded candidate/profile context exists. Without grounding, use the required no-context admission opener and keep any example illustrative, unnamed, modest, and qualitative.',
    example_request: 'Provide one concrete example from grounded context when available. Without grounding, label it as illustrative and avoid invented names, companies, dates, metrics, or first-person claims.',
    summary_probe: 'Confirm the summary briefly and add one clarifying point if needed.',
    coding: 'Provide a FULL, complete, working and production-ready code implementation (including necessary boilerplate like Java imports/classes). Start with a brief approach description, then the fully runnable code block, then a concise explanation of why this approach works.',
    general: 'Respond naturally based on context. Keep it conversational and direct.',

    silence: 'Return exactly: "Nothing actionable right now." No filler, no commentary.',
    define_term: 'Bold the term; 1-2 sentence plain-language explanation. No dictionary format. Connect to a relevant point in context.',
    advance_dialog: 'Suggest exactly 3 short follow-up questions or one concrete next step.',

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
    fde_discovery: '',
    fde_integration: '',
    fde_security: '',
    fde_risk: '',
    fde_success: '',
    fde_next_step: '',
};

const SALES_ANSWER_SHAPES: Partial<Record<ConversationIntent, string>> = {
    handle_objection: 'Acknowledge first ("That makes sense" / "I hear you"). Reframe with specifics. End with a forward-moving question. 2-3 sentences. No labels.',
    seize_signal: 'Propose a concrete next step with a specific time. Trade value for commitment. 1-2 sentences. Confident, no hedge.',
    discovery_probe: 'Ask 1-2 deep diagnostic questions, not surface. Example: "What challenge were you hoping to solve when you reached out?"',
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

export function getLabelMapForMode(
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

export function isPrimarilyChinese(text: string, threshold = 0.3): boolean {
    if (!text) return false;
    const cjkChars = text.match(/[一-鿿]/g);
    if (!cjkChars || cjkChars.length === 0) return false;
    const stripped = text.replace(/[\s　-〿.,!?;:'"()\[\]{}<>—\-]/g, '');
    if (stripped.length === 0) return false;
    return cjkChars.length / stripped.length >= threshold;
}

export const SLM_CONFIDENCE_THRESHOLD = 0.35;
