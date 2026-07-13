// electron/llm/IntentClassifier.ts
// Lightweight intent classification for "What should I say?"
// Micro step that runs before answer generation
//
// Chinese-first classification:
//   1. Mode-aware rules and lightweight entity/language checks.
//   2. Cloud intent fallback for low-confidence Chinese turns when transcript
//      data scope allows it.
//   3. Optional local multilingual mDeBERTa enhancement only when explicitly
//      enabled by the user.
//   4. Context heuristic fallback.

import { getIntentClassifierProcessHost } from './IntentClassifierProcessHost';
import {
    matchIntentKeywords,
    type IntentKeywordMap,
} from './IntentKeywordDefaults';
import type { ProviderDataScopePolicy } from './ProviderRouter';

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
    | 'sales_pricing_objection' // Price/budget objection
    | 'sales_quote_request' // Quote, proposal, or commercial terms request
    | 'sales_proof_request' // Case study, proof, similar customer, or ROI request
    | 'sales_technical_requirements' // API, SSO, security, deployment, or integration requirements
    | 'sales_buying_signal' // Legal, contract, pilot, next step, or purchase signal
    | 'sales_pain_discovery' // Customer describes current pain, broken workflow, or operational friction
    | 'sales_capability_fit' // Customer asks whether capability fits an industrial software scenario
    | 'sales_process_integration' // Customer discusses PLM/QMS/ERP/MES/ALM/CAD process integration
    | 'sales_value_discovery' // Customer describes value, efficiency, quality, or metric impact
    | 'sales_contextual_proof_discovery' // Customer asks for proof anchored to industrial context

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

    // ===== FDE mode intents =====
    | 'fde_discovery'      // Customer workflow, requirements, and stakeholder discovery
    | 'fde_integration'    // API, data source, auth, SSO, environment, or integration details
    | 'fde_security'       // Privacy, compliance, permissions, data residency, audit, or PII concerns
    | 'fde_risk'           // Deployment blocker, dependency, migration risk, or timeline risk
    | 'fde_agent_feasibility' // AI Agent automation boundary, human confirmation, or read-only/write-back split
    | 'fde_success'        // Success criteria, acceptance, pilot outcome, or measurement
    | 'fde_next_step'      // Concrete next step, owner, rollout plan, or follow-up

    // ===== Fallback =====
    | 'general';           // Default fallback

export interface IntentResult {
    intent: ConversationIntent;
    confidence: number;
    answerShape: string;
}

export interface CloudIntentClassifierInput {
    latestTurn: string;
    recentTranscript: string;
    modeTemplateType?: string | null;
    candidateIntents: ConversationIntent[];
    language: 'zh' | 'en';
    keyEntities: string[];
}

export interface CloudIntentClassifierResult {
    intent: ConversationIntent;
    confidence: number;
}

export interface IntentClassificationOptions {
    providerDataScopes?: ProviderDataScopePolicy;
    cloudIntentClassifier?: (input: CloudIntentClassifierInput) => Promise<CloudIntentClassifierResult | null>;
    cloudFirst?: boolean;
    localIntentEnhancementEnabled?: boolean;
    localIntentEnhancementAvailable?: boolean;
    localIntentClassifier?: (text: string, modeTemplateType?: string | null) => Promise<IntentResult | null>;
    customIntentKeywords?: IntentKeywordMap;
}

export interface IntentWarmupOptions {
    localIntentEnhancementEnabled?: boolean;
    localIntentEnhancementAvailable?: boolean;
    localWarmup?: () => void;
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
    sales_pricing_objection: '',
    sales_quote_request: '',
    sales_proof_request: '',
    sales_technical_requirements: '',
    sales_buying_signal: '',
    sales_pain_discovery: '',
    sales_capability_fit: '',
    sales_process_integration: '',
    sales_value_discovery: '',
    sales_contextual_proof_discovery: '',
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
    fde_agent_feasibility: '',
    fde_success: '',
    fde_next_step: '',
};

const SALES_ANSWER_SHAPES: Partial<Record<ConversationIntent, string>> = {
    sales_pricing_objection: 'Generate a short spoken response that acknowledges price/budget concern, grounds value in provided context, and asks one forward question.',
    sales_quote_request: 'Generate a follow-up email draft for quote/proposal request. Use placeholders unless exact trusted values are present.',
    sales_proof_request: 'Use uploaded/reference materials for proof points or state that no grounded proof was provided. Never invent customer cases or ROI.',
    sales_technical_requirements: 'Generate a clarification checklist for API, SSO, security, deployment environment, owners, and validation step.',
    sales_buying_signal: 'Lock next step, owner, date, and artifact. Ask directly for missing fields.',
    sales_pain_discovery: 'Ask 1-3 customer-facing discovery questions that clarify the current pain, impact, owner, and workflow. Do not answer as a product expert.',
    sales_capability_fit: 'Ask 1-3 customer-facing discovery questions that clarify required capability, usage scenario, constraints, and success criteria. Do not claim support.',
    sales_process_integration: 'Ask 1-3 customer-facing discovery questions that clarify systems, data direction, ownership, and process boundary. Do not propose writeback.',
    sales_value_discovery: 'Ask 1-3 customer-facing discovery questions that clarify business metric, baseline, value driver, and decision criteria.',
    sales_contextual_proof_discovery: 'Ask 1-3 customer-facing discovery questions that clarify what proof, industry, workflow, or outcome would be relevant. Do not invent cases or ROI.',
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

const FDE_ANSWER_SHAPES: Partial<Record<ConversationIntent, string>> = {
    fde_discovery: 'Ask 1-2 concrete workflow or stakeholder questions. Anchor on customer reality, not generic product discovery.',
    fde_integration: 'Clarify the integration surface: system, auth, data direction, environment, owner, and smallest validation step.',
    fde_security: 'Respond with a security-conscious checklist: data involved, permissions, compliance review, auditability, and decision owner.',
    fde_risk: 'Name the blocker or risk, identify dependency and impact, then propose the next unblock step. Do not guess missing owners.',
    fde_agent_feasibility: 'Explain the AI Agent boundary as a checklist: what AI can suggest, what needs human confirmation, and what must stay read-only or never auto-write.',
    fde_success: 'Turn the discussion into measurable acceptance criteria or pilot success metrics. Keep it concrete and testable.',
    fde_next_step: 'Convert the conversation into owner, deliverable, and date. If one is missing, ask for it directly.',
    define_term: 'Define the technical or deployment term in one sentence, then connect it to the customer deployment context.',
};

const MODE_ANSWER_SHAPES: Record<string, Partial<Record<ConversationIntent, string>>> = {
    'general': {},
    'looking-for-work': {},
    'sales': SALES_ANSWER_SHAPES,
    'fde': FDE_ANSWER_SHAPES,
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
        'customer raising a price or budget objection': 'sales_pricing_objection',
        'customer asking for quote, pricing, proposal, or commercial terms': 'sales_quote_request',
        'customer asking for case study, proof, similar customer, or ROI': 'sales_proof_request',
        'customer asking about API, SSO, security, deployment, or technical requirements': 'sales_technical_requirements',
        'customer showing buying intent, legal review, contract, pilot, or next step': 'sales_buying_signal',
        'customer describing industrial software pain or broken workflow': 'sales_pain_discovery',
        'customer asking whether an industrial software capability fits their scenario': 'sales_capability_fit',
        'customer discussing PLM, QMS, ERP, MES, ALM, CAD, or AI Agent process integration': 'sales_process_integration',
        'customer discussing efficiency, quality, cycle time, cost, audit, or value impact': 'sales_value_discovery',
        'customer asking for industrial proof, customer example, ROI, or case context': 'sales_contextual_proof_discovery',
        'no actionable content, just filler or acknowledgement': 'silence',
        'asking what a term or acronym means': 'define_term',
        'requesting a summary or next step': 'advance_dialog',
        'general conversation or question': 'general',
    },
    'fde': {
        'discovering customer workflow, requirements, stakeholders, or deployment context': 'fde_discovery',
        'reviewing manufacturing PLM/BOM/ECO workflows or release/version rules': 'fde_discovery',
        'discussing API, data source, authentication, environment, or integration details': 'fde_integration',
        'reviewing privacy, compliance, permissions, audit logs, PII, or security concerns': 'fde_security',
        'raising deployment risk, blocker, dependency, migration, rollback, or timeline concern': 'fde_risk',
        'reviewing AI Agent automation boundaries, human confirmation, or read-only/write-back split': 'fde_agent_feasibility',
        'defining pilot success, validation, metrics, acceptance criteria, or sign-off': 'fde_success',
        'confirming owner, next step, rollout plan, launch plan, or follow-up date': 'fde_next_step',
        'asking what a term or acronym means': 'define_term',
        'requesting a summary or next step': 'advance_dialog',
        'general conversation or question': 'general',
        'no actionable content, just filler or acknowledgement': 'silence',
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
        '客户提出价格或预算异议': 'sales_pricing_objection',
        '客户索要报价、proposal 或商务条款': 'sales_quote_request',
        '客户索要案例、类似客户、ROI 或证明材料': 'sales_proof_request',
        '客户询问 API、SSO、安全、部署或技术需求': 'sales_technical_requirements',
        '客户表达购买推进、法务、合同、试点或下一步信号': 'sales_buying_signal',
        '客户描述工业软件痛点、现状问题或流程断点': 'sales_pain_discovery',
        '客户询问工业软件功能是否适合当前场景': 'sales_capability_fit',
        '客户讨论 PLM、QMS、ERP、MES、ALM、CAD 或 AI Agent 的流程打通': 'sales_process_integration',
        '客户讨论效率、质量、周期、成本、审计或价值指标': 'sales_value_discovery',
        '客户索要带工业场景的案例、证明、ROI 或类似客户': 'sales_contextual_proof_discovery',
        '无可行动内容,只是寒暄或确认': 'silence',
        '询问某个术语或缩写的含义': 'define_term',
        '请求总结或下一步': 'advance_dialog',
        '一般性对话或问题': 'general',
    },
    'fde': {
        '正在澄清客户流程、业务需求、干系人或部署上下文': 'fde_discovery',
        '正在澄清制造业 PLM、BOM、ECO 流程或发布/版本规则': 'fde_discovery',
        '正在讨论 API、数据源、认证、环境或集成细节': 'fde_integration',
        '正在讨论隐私、合规、权限、审计日志、PII 或安全问题': 'fde_security',
        '正在提出部署风险、阻塞、依赖、迁移、回滚或时间线问题': 'fde_risk',
        '正在确认 AI Agent 自动化边界、人工确认或只读/写回分界': 'fde_agent_feasibility',
        '正在定义试点成功、验证指标、验收标准或签署确认': 'fde_success',
        '正在确认负责人、下一步、上线计划、推进计划或跟进时间': 'fde_next_step',
        '询问某个术语或缩写的含义': 'define_term',
        '请求总结或下一步': 'advance_dialog',
        '一般性对话或问题': 'general',
        '无可行动内容,只是寒暄或确认': 'silence',
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
    customIntentKeywords?: IntentKeywordMap,
): IntentResult | null {
    const text = lastInterviewerTurn.toLowerCase().trim();
    const mode = modeTemplateType ?? 'general';
    if (customIntentKeywords) {
        const intent = matchIntentKeywords(text, mode, customIntentKeywords);
        return intent
            ? { intent, confidence: confidenceForKeywordIntent(intent), answerShape: getAnswerShapeForMode(mode, intent) }
            : null;
    }

    // Interview-family modes: 7-intent regex (default behaviour, preserved).
    if (isModeInterviewFamily(mode)) {
        return detectInterviewIntentByPattern(text);
    }

    // Non-interview modes: specialized regex per mode. Falls through to null
    // (SLM territory) if no specialized pattern matches.
    switch (mode) {
        case 'sales':
            return detectSalesIntentByPattern(text);
        case 'fde':
            return detectFdeIntentByPattern(text);
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

function confidenceForKeywordIntent(intent: ConversationIntent): number {
    switch (intent) {
        case 'seize_signal':
        case 'sales_buying_signal':
            return 0.95;
        case 'handle_objection':
        case 'sales_pricing_objection':
        case 'capture_action':
            return 0.92;
        case 'capture_decision':
        case 'explain_concept':
        case 'render_formula':
        case 'coding':
        case 'behavioral':
        case 'clarification':
        case 'fde_security':
        case 'fde_risk':
        case 'fde_next_step':
            return 0.9;
        case 'capture_risk':
        case 'request_example':
            return 0.88;
        case 'sales_proof_request':
        case 'sales_technical_requirements':
            return 0.88;
        case 'sales_quote_request':
            return 0.86;
        case 'fde_integration':
        case 'fde_success':
        case 'fde_discovery':
            return 0.85;
        case 'discovery_probe':
        case 'status_update':
        case 'answer_class_question':
        case 'follow_up':
        case 'deep_dive':
        case 'example_request':
        case 'summary_probe':
            return 0.85;
        default:
            return 0.75;
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
    if (/(write code|program|implement|function for|algorithm|data structure|how to code|setup a .* project|using .* library|debug this|snippet|boilerplate|example of .* in .*|optimize|refactor|best practice for .* code|utility method|component for|logic for)/i.test(text)
        || /(写代码|写一下代码|实现一下|解这道题|解一下|数据结构|代码怎么写|这个算法|怎么实现|实现这个|怎么写|如何实现|用.*实现|.*的代码|调试|优化|重构|怎么优化|怎么调试)/.test(text)) {
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
    if (/(ready to move|ready to sign|send (over )?(the|a) contract|let'?s move forward|next steps|finalize|sign the deal|legal review|procurement|when can we start|let'?s get started|let'?s (kick ?off|schedule)|pilot|trial)/i.test(text)
        || /(准备签|准备推进|准备敲定|准备开始|想推进到|推进到.{0,6}(?:法务|放假).{0,4}审核|发合同|法务审核|放假审核|采购流程|下一步怎么走|下一步是|敲定|签合同|推进到|往下走|启动|试点|(?<!测)试用)/.test(text)) {
        return { intent: 'sales_buying_signal', confidence: 0.95, answerShape: getAnswerShapeForMode('sales', 'sales_buying_signal') };
    }
    // 2. Pricing objection — price/budget pushback, not internal price-sheet references.
    if (/(too expensive|too pricey|too high|can'?t afford|out of (our|my|the) budget|not in (our|my|the) budget|cheaper (option|alternative)|discount|price is|reduce the price|lower the price|do better on (price|cost)|can you (do better|lower|reduce))/i.test(text)
        || /(太贵|价格高|价格太高|报价太高|超出预算|预算不够|预算不足|预算.{0,8}过不了|年付.{0,12}预算.{0,8}过不了|太高.{0,12}预算|负担不起|能不能便宜|便宜点|打个折|有折扣吗)/.test(text)) {
        return { intent: 'sales_pricing_objection', confidence: 0.92, answerShape: getAnswerShapeForMode('sales', 'sales_pricing_objection') };
    }
    const industrialDiscovery = detectSalesIndustrialDiscoveryIntent(text);
    if (industrialDiscovery) return industrialDiscovery;
    if (INDUSTRIAL_DOMAIN_PATTERN.test(text)
        && /(客户案例|成功案例|类似客户|标杆客户|参考客户|证明材料|落地案例|实施案例|ROI|投资回报|回报率|case study|customer story|customer example|similar customer|reference customer)/i.test(text)) {
        return null;
    }

    // 3. Proof request — case study, similar customer, or ROI proof.
    if (/(case study|customer story|customer example|reference customer|proof point|success story|similar customer|ROI|return on investment|prove the value|prove the ROI)/i.test(text)
        || /(客户案例|成功案例|类似客户|标杆客户|参考客户|证明材料|落地案例|实施案例|ROI|投资回报|回报率|证明价值)/.test(text)) {
        return { intent: 'sales_proof_request', confidence: 0.88, answerShape: getAnswerShapeForMode('sales', 'sales_proof_request') };
    }
    // 4. Technical requirements — clarify before promising capability.
    if (/(technical requirements?|technical needs?|integration requirements?|API requirements?|security requirements?|deployment requirements?|implementation details?|technical solution|architecture requirements?|SSO requirements?|SOC2|data residency|production environment|sandbox)/i.test(text)
        || /(技术需求|技术要求|集成需求|集成要求|接口需求|API 需求|部署要求|安全要求|技术方案|实现细节|对接方式|架构要求|SSO 对接|生产环境|沙盒|数据驻留)/.test(text)) {
        return { intent: 'sales_technical_requirements', confidence: 0.88, answerShape: getAnswerShapeForMode('sales', 'sales_technical_requirements') };
    }
    // 5. Quote request — external ask for pricing/proposal/commercial terms.
    if (!/(我们的报价表|内部报价|报价表在这|等客户问再发|internal price|price sheet)/i.test(text)
        && (/(send me pricing|send pricing|send (over )?(the|a) proposal|send (over )?(the|a) quote|pricing page|quote|proposal|commercials|commercial terms|what does it cost)/i.test(text)
            || /(发我报价|发.{0,6}报价|给.{0,6}报价|报(?:个|一下|下)价(?:格)?|给(?:我)?(?:个|一下|下)价(?:格)?|报价单|价格页|方案报价|商务条款|多少钱)/.test(text))) {
        return { intent: 'sales_quote_request', confidence: 0.86, answerShape: getAnswerShapeForMode('sales', 'sales_quote_request') };
    }
    return null;
}

const INDUSTRIAL_DOMAIN_PATTERN = /\b(PLM|Windchill|QMS|ERP|SAP|Oracle|MES|ALM|Creo|CAD|BOM|ECO|ECN|CAPA|NCR|8D|AI Agent|Agent)\b|图纸|物料|变更|工艺|工单|质量|审计|仿真|流体仿真|力学仿真|装配|测试用例|缺陷|需求追踪|追踪矩阵/i;
const INDUSTRIAL_PAIN_PATTERN = /不同步|不一致|断链|断点|痛苦|靠邮件|Excel|人工|重复录入|旧工艺|返工|停线|误判|复核|很慢|压力/i;
const INDUSTRIAL_CAPABILITY_PATTERN = /BOM 变更.{0,12}质量问题.{0,12}能不能关联起来|AI Agent.{0,20}能不能.{0,24}(?:先帮我们查|不要自动写回)/i;
const INDUSTRIAL_INTEGRATION_PATTERN = /打通|集成|同步|闭环|流转|对齐|读写边界|权限边界|源系统|目标系统|工具调用/i;
const INDUSTRIAL_VALUE_PATTERN = /效率|周期|成本|质量成本|良率|延期|审计压力|返工|停线|成功指标|评审效率/i;
const CONTEXTUAL_PROOF_PATTERN = /Windchill ECO.{0,30}QMS CAPA.{0,30}(?:案例|客户|证明|ROI)|(?:只读 )?AI Agent.{0,40}PLM.{0,40}(?:人工确认)?.{0,30}(?:案例|客户|证明|ROI)/i;

function detectSalesIndustrialDiscoveryIntent(text: string): IntentResult | null {
    if (!INDUSTRIAL_DOMAIN_PATTERN.test(text)) return null;

    if (/力学仿真模块.{0,24}功能是否适合|流体仿真.{0,12}功能|介绍一下.{0,12}流体仿真.{0,12}功能/i.test(text)) {
        return { intent: 'sales_capability_fit', confidence: 0.88, answerShape: getAnswerShapeForMode('sales', 'sales_capability_fit') };
    }
    if (CONTEXTUAL_PROOF_PATTERN.test(text)) {
        return { intent: 'sales_contextual_proof_discovery', confidence: 0.9, answerShape: getAnswerShapeForMode('sales', 'sales_contextual_proof_discovery') };
    }
    if (/靠邮件.{0,20}不同步|客诉.{0,40}Excel.{0,20}痛苦|现场执行.{0,20}设计变更不同步|需求改.{0,40}断链|Creo.{0,40}同步不及时/i.test(text)
        || (INDUSTRIAL_PAIN_PATTERN.test(text) && /拿到旧工艺/.test(text))) {
        return { intent: 'sales_pain_discovery', confidence: 0.88, answerShape: getAnswerShapeForMode('sales', 'sales_pain_discovery') };
    }
    if (/Windchill ECO.{0,30}ERP.{0,30}QMS CAPA.{0,12}闭环|PLM 发布 BOM.{0,30}同步到 SAP/i.test(text)) {
        return { intent: 'sales_process_integration', confidence: 0.88, answerShape: getAnswerShapeForMode('sales', 'sales_process_integration') };
    }
    if (/变更影响分析太慢.{0,40}周期/.test(text)) {
        return { intent: 'sales_value_discovery', confidence: 0.86, answerShape: getAnswerShapeForMode('sales', 'sales_value_discovery') };
    }
    if (INDUSTRIAL_CAPABILITY_PATTERN.test(text)) {
        return { intent: 'sales_capability_fit', confidence: 0.86, answerShape: getAnswerShapeForMode('sales', 'sales_capability_fit') };
    }

    return null;
}

/**
 * Team-meet mode regex (English + Chinese). Captures action items, decisions,
 * risks, and status updates as discrete intents.
 */
function detectTeamMeetIntentByPattern(text: string): IntentResult | null {
    // 1. Action item — ownership + commitment.
    // Debug session 2026-06-23: removed three overly-broad Chinese tokens that
    // were shadowing later, more-specific intents:
    //   - `截止` shadowed status_update's `截止日期` (e.g. "截止日期是什么时候?")
    //   - `完成` shadowed capture_risk's `等.*完成` (e.g. "有个依赖要等前端完成")
    //   - `上线` shadowed capture_risk's `延期` (e.g. "上线日期要延期了")
    // The remaining tokens all directly express "I own this" + a deadline,
    // which is the real action-item signal. Bare `截止`/`完成`/`上线` are not
    // action-item markers by themselves — they only become meaningful when
    // paired with a verb (周五前完成) or in compound phrases (截止日期),
    // which is where capture_risk / status_update own them.
    if (/(i'?ll (do|send|handle|own|take|follow up|write|ship|PR|merge)|I'?m gonna|let me .* by|action item|to-do|assigned to|owner is|@.* (please )?(do|own|handle)|I can have .* by|by (monday|tuesday|wednesday|thursday|friday|EOD|EOW|next week))/i.test(text)
        || /(我来做|我来发|我来负责|我来处理|我跟进|我写|我来 PR|我提|我合|交给我|我包了|分配给|让.*来|让.*做|行动项|待办|跟进项|周五前|周一前|下周三前|今天内|尽快|尽快.*交|交付)/.test(text)) {
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

function detectFdeIntentByPattern(text: string): IntentResult | null {
    if (/(PLM|QMS|ERP|MES|document system|Windchill).*(data direction|read[- ]?write|read[- ]?only|write[- ]?back|role|permission|environment|sandbox|production|integration)/i.test(text)
        || /(ERP|MES|PLM|QMS|文档系统|Windchill).*(数据方向|读写边界|只读|写回|角色|权限|环境|沙盒|生产环境|测试环境|集成|打通)/i.test(text)) {
        return { intent: 'fde_integration', confidence: 0.9, answerShape: getAnswerShapeForMode('fde', 'fde_integration') };
    }
    if (/(PII|SOC2|compliance|audit logs?|permissions?|access control|data residency|encryption|security review|privacy)/i.test(text)
        || /(合规|审计日志|权限|访问控制|数据驻留|加密|安全评审|隐私|敏感数据|脱敏)/.test(text)) {
        return { intent: 'fde_security', confidence: 0.92, answerShape: getAnswerShapeForMode('fde', 'fde_security') };
    }
    if (/(blocker|blocked|dependency|risk|timeline|delay|migration|cutover|rollback|edge case|launch risk|NCR|CAPA|8D|non-conformance|traceability|quality|audit)/i.test(text)
        || /(阻塞|卡住|依赖|风险|延期|迁移|切换|回滚|边界情况|上线风险|不确定|NCR|CAPA|8D|质量|追溯|审计|偏差)/.test(text)) {
        return { intent: 'fde_risk', confidence: 0.9, answerShape: getAnswerShapeForMode('fde', 'fde_risk') };
    }
    if (/(agent|AI agent|automation|human in the loop|approval flow|tool call|read[- ]?only|write back|auto[- ]?write|write to PLM|write to QMS)/i.test(text)
        || /(智能体|AI Agent|自动化|人审|人工确认|审批流|工具调用|只读|写回|自动写入|写入 PLM|写入 QMS)/.test(text)) {
        return { intent: 'fde_agent_feasibility', confidence: 0.87, answerShape: getAnswerShapeForMode('fde', 'fde_agent_feasibility') };
    }
    if (/(next step|owner|follow up|action item|rollout plan|launch plan|go live|by friday|by next week)/i.test(text)
        || /(下一步|负责人|跟进|行动项|上线计划|推进计划|灰度|正式上线|周五前|下周)/.test(text)) {
        return { intent: 'fde_next_step', confidence: 0.9, answerShape: getAnswerShapeForMode('fde', 'fde_next_step') };
    }
    if (/(API|endpoint|webhook|SSO|SAML|OAuth|SCIM|data source|database|warehouse|environment|sandbox|production|staging|integration|PLM|QMS|ERP|MES|document system|data direction|read[- ]?write boundary)/i.test(text)
        || /(API 接口|接口|端点|回调|单点登录|数据源|数据库|数仓|环境|沙盒|生产环境|测试环境|集成|打通|PLM|QMS|ERP|MES|文档系统|数据方向|读写边界)/.test(text)) {
        return { intent: 'fde_integration', confidence: 0.88, answerShape: getAnswerShapeForMode('fde', 'fde_integration') };
    }
    if (/(success criteria|acceptance criteria|acceptance test|pilot|POC|measurement|metric|KPI|validation|sign off)/i.test(text)
        || /(验收标准|成功标准|试点|验证|指标|度量|KPI|验收测试|通过标准|效果衡量)/.test(text)) {
        return { intent: 'fde_success', confidence: 0.88, answerShape: getAnswerShapeForMode('fde', 'fde_success') };
    }
    if (/(current workflow|current process|business process|user workflow|stakeholder|requirements|what are you trying to solve|what does success look like|PLM|BOM|ECO|ECN|revision|version|release|part number|drawing|material master|routing|manufacturing)/i.test(text)
        || /(现有流程|当前流程|业务流程|用户流程|需求是什么|想解决什么|谁会使用|谁负责|干系人|业务场景|客户现场|PLM|BOM|ECO|ECN|版本|变更单|发布|图纸|物料|工艺)/.test(text)) {
        return { intent: 'fde_discovery', confidence: 0.85, answerShape: getAnswerShapeForMode('fde', 'fde_discovery') };
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

function getCandidateIntentsForMode(modeTemplateType?: string | null): ConversationIntent[] {
    const mode = modeTemplateType ?? 'general';
    switch (mode) {
        case 'sales':
            return [
                'sales_buying_signal',
                'sales_pricing_objection',
                'sales_quote_request',
                'sales_contextual_proof_discovery',
                'sales_capability_fit',
                'sales_process_integration',
                'sales_value_discovery',
                'sales_pain_discovery',
                'sales_proof_request',
                'sales_technical_requirements',
                'define_term',
                'advance_dialog',
                'general',
                'silence',
            ];
        case 'fde':
            return ['fde_discovery', 'fde_integration', 'fde_security', 'fde_risk', 'fde_agent_feasibility', 'fde_success', 'fde_next_step', 'define_term', 'advance_dialog', 'general', 'silence'];
        case 'recruiting':
            return ['evaluate_answer', 'request_example', 'clarification', 'follow_up', 'deep_dive', 'define_term', 'general', 'silence'];
        case 'team-meet':
            return ['capture_action', 'capture_decision', 'capture_risk', 'status_update', 'advance_dialog', 'general', 'silence'];
        case 'lecture':
            return ['explain_concept', 'render_formula', 'answer_class_question', 'define_term', 'advance_dialog', 'general', 'silence'];
        case 'technical-interview':
            return ['coding', 'clarification', 'deep_dive', 'follow_up', 'example_request', 'define_term', 'general', 'silence'];
        case 'looking-for-work':
        case 'general':
        default:
            return ['clarification', 'follow_up', 'deep_dive', 'behavioral', 'example_request', 'summary_probe', 'coding', 'define_term', 'advance_dialog', 'general', 'silence'];
    }
}

function extractLightweightEntities(text: string): string[] {
    const entities = new Set<string>();
    const patterns = [
        /[A-Za-z][A-Za-z0-9_+#.-]{1,30}/g,
        /\d+(?:\.\d+)?\s*(?:%|元|万|美元|天|周|个月|年)/g,
        /(?:今天|明天|后天|本周|下周|月底|年底|周[一二三四五六日天])/g,
        /(?:合同|报价|预算|价格|采购|法务|风险|阻塞|决策|行动项|公式|定理|复杂度|系统设计)/g,
    ];

    for (const pattern of patterns) {
        for (const match of text.matchAll(pattern)) {
            const value = match[0]?.trim();
            if (value) entities.add(value);
            if (entities.size >= 12) return Array.from(entities);
        }
    }

    return Array.from(entities);
}

async function classifyWithCloudFallback(
    latestTurn: string,
    recentTranscript: string,
    modeTemplateType: string | null | undefined,
    options: IntentClassificationOptions,
): Promise<IntentResult | null> {
    if (!options.cloudIntentClassifier) return null;
    if (options.providerDataScopes?.transcript === false) return null;
    const language = isPrimarilyChinese(latestTurn) ? 'zh' : 'en';
    if (
        language === 'en' &&
        !((modeTemplateType ?? 'general') === 'sales' && INDUSTRIAL_DOMAIN_PATTERN.test(latestTurn))
    ) {
        return null;
    }

    try {
        const result = await options.cloudIntentClassifier({
            latestTurn,
            recentTranscript,
            modeTemplateType,
            candidateIntents: getCandidateIntentsForMode(modeTemplateType),
            language,
            keyEntities: extractLightweightEntities(`${latestTurn}\n${recentTranscript}`),
        });
        if (!result || result.confidence < 0.5) return null;
        return {
            intent: result.intent,
            confidence: result.confidence,
            answerShape: getAnswerShapeForMode(modeTemplateType, result.intent),
        };
    } catch (error) {
        console.warn('[IntentClassifier] Cloud fallback failed', {
            error: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

// ========================
// Public API
// ========================

/**
 * Main intent classification function (async)
 *
 * Default priority:
 *   1. Regex fast-path (< 1ms, high confidence) — mode-aware
 *   2. Cloud intent fallback for Chinese low-confidence turns
 *   3. Optional local zero-shot SLM when explicitly enabled
 *   4. Context-based heuristic (0ms, low confidence)
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
    options: IntentClassificationOptions = {},
): Promise<IntentResult> {
    // Tier 1: Try regex-based first (high confidence, instant)
    if (lastInterviewerTurn) {
        if (options.cloudFirst === true) {
            const cloudFirstResult = await classifyWithCloudFallback(lastInterviewerTurn, recentTranscript, modeTemplateType, options);
            if (cloudFirstResult) {
                return cloudFirstResult;
            }
        }

        const patternResult = detectIntentByPattern(lastInterviewerTurn, modeTemplateType, options.customIntentKeywords);
        if (patternResult) {
            return patternResult;
        }

        // Tier 2: Cloud intent fallback for Chinese low-confidence turns.
        if (options.cloudFirst !== true) {
            const cloudResult = await classifyWithCloudFallback(lastInterviewerTurn, recentTranscript, modeTemplateType, options);
            if (cloudResult) {
                return cloudResult;
            }
        }

        // Tier 3: Optional local zero-shot SLM. Disabled by default because
        // the multilingual model is a large optional offline enhancement.
        if (lastInterviewerTurn.trim().length > 5) {
            const localClassifier = options.localIntentClassifier ?? ((text, mode) => getIntentClassifierProcessHost().classify(text, mode));
            if (options.localIntentEnhancementEnabled === true && options.localIntentEnhancementAvailable === true) {
                const slmResult = await localClassifier(lastInterviewerTurn, modeTemplateType);
                if (slmResult) {
                    return slmResult;
                }
            }
        }
    }

    // Tier 4: Fall back to context-based heuristic
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
 * Pre-warm the optional local SLM model in background.
 * No-op unless the user enabled local intent enhancement and the artifact is
 * already installed.
 */
export function warmupIntentClassifier(options: IntentWarmupOptions = {}): void {
    if (options.localIntentEnhancementEnabled !== true) return;
    if (options.localIntentEnhancementAvailable !== true) return;
    const warmup = options.localWarmup ?? (() => getIntentClassifierProcessHost().warmup());
    warmup();
}
