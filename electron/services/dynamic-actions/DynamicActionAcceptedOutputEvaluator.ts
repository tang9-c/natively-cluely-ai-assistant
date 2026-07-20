import type { DynamicActionOutputType } from './DynamicAction';
import type { ActionArtifact } from './DynamicActionArtifacts';
import type { ClaimGroundingVerdict } from './DynamicActionClaimGroundingVerifier';

export interface AcceptedOutputEvaluationInput {
  actionType: string;
  outputType: DynamicActionOutputType;
  answerText: string;
  groundedSources?: ActionArtifact['groundedSources'];
  missingFields?: string[];
  sourceUtterance?: string;
  sourceIntent?: string;
  claimGrounding?: ClaimGroundingVerdict;
  transcriptEvidence?: string[];
}

export interface AcceptedOutputEvaluationResult {
  passed: boolean;
  requiredPatternFailures: string[];
  forbiddenPatternFailures: string[];
  groundingFailures: string[];
  missingFieldFailures: string[];
}

export function evaluateDynamicActionAcceptedOutput(
  input: AcceptedOutputEvaluationInput,
): AcceptedOutputEvaluationResult {
  const answer = input.answerText.trim();
  const requiredPatternFailures: string[] = [];
  const forbiddenPatternFailures: string[] = [];
  const groundingFailures: string[] = [];
  const missingFieldFailures: string[] = [];

  const requirePattern = (label: string, pattern: RegExp) => {
    if (!pattern.test(answer)) requiredPatternFailures.push(label);
  };
  const forbidPattern = (label: string, pattern: RegExp) => {
    if (pattern.test(answer)) forbiddenPatternFailures.push(label);
  };
  const hasUsedGrounding = (types: string[]) =>
    (input.groundedSources ?? []).some((source) => types.includes(source.type) && source.status === 'used');
  const hasNoMatchGrounding = () =>
    (input.groundedSources ?? []).some((source) => source.status === 'not_found') ||
    /没有.*(匹配|找到)|no matching|not found|不编/i.test(answer);

  if (!answer) {
    requiredPatternFailures.push('non_empty_answer');
  }

  if (input.actionType === 'pricing_objection') {
    requirePattern('spoken_response', /我|我们|可以|先|let|we|I/i);
    forbidPattern('invented_discount_or_ROI', /(\d+\s*%|折扣|discount|ROI\s*(至少|guarantee|>|超过)?\s*\d+)/i);
    forbidPattern('list_only_value_points', /^(?:[-*]\s*)?(价值点|value props?)[:：]/i);
  }

  if (input.actionType === 'pricing_request') {
    requirePattern('email_draft_shape', /(Subject:|Hi\s+\[CUSTOMER_NAME\]|\[CUSTOMER_NAME\])/i);
    requirePattern('next_step_placeholder', /\[NEXT_STEP\]|scope|范围|下一步/i);
    forbidPattern('invented_price_or_terms', /(\$|¥|人民币|USD|CNY)\s*\d|合同条款已定|net\s*\d+|付款条件/i);
  }

  if (input.actionType === 'case_study_request') {
    if (!hasUsedGrounding(['material', 'pptx']) && !hasNoMatchGrounding()) {
      groundingFailures.push('case_study_requires_material_or_no_match');
    }
    forbidPattern('invented_customer_or_roi', /Fortune\s*500|世界500强|ROI\s*(都|guarantee|至少|很高|\d)|客户都/i);
  }

  if (input.actionType === 'capability_fit_answer') {
    const usedGrounding = hasUsedGrounding(['material', 'pptx', 'business_context']);
    const statesInsufficiency = /资料不足|不能确认|不能承诺|not enough|cannot confirm|cannot promise/i.test(answer);
    const proposesValidation = /PoC|样本|能力矩阵|补充.*资料|验证|pilot|capability matrix|validation/i.test(answer);
    const hasPositiveClaim = containsPositiveCapabilityClaim(answer);
    if (hasPositiveClaim && (!usedGrounding || input.claimGrounding?.verdict !== 'supported')) {
      groundingFailures.push('capability_claim_not_supported_by_injected_evidence');
    }
    if (!usedGrounding && (!statesInsufficiency || !proposesValidation)) {
      groundingFailures.push('capability_fit_requires_insufficiency_and_validation');
    }
    forbidPattern('invented_customer_roi_price_or_terms', /标杆客户|世界500强|Fortune\s*500|ROI|\d+\s*%|[$¥]\s*\d|合同条款/i);
    forbidPattern('automatic_writeback_claim', /(?:会|可|可以|支持).{0,8}自动(?:写回|更新)|(?:will|can|supports?).{0,12}auto(?:matic)?\s+(?:write|update)/i);
    enforceCapabilityFitLength(answer, requiredPatternFailures);
  }

  if (input.actionType === 'fde_grounded_answer') {
    const usedGrounding = hasUsedGrounding(['material', 'pptx', 'business_context']);
    const statesInsufficiency = /资料不足|信息不足|不能确认|不能承诺|not enough|insufficient|cannot confirm|cannot promise/i.test(answer);
    const proposesValidation = /PoC|样本流程|样本|测试数据|验证|pilot|sample process|test data|validation|acceptance/i.test(answer);
    const hasPositiveClaim = containsPositiveCapabilityClaim(answer) ||
      /已发布|已审批|审批完成|已关闭|Released|Approved|Closed|state is|version/i.test(answer);
    if (hasPositiveClaim && (!usedGrounding || input.claimGrounding?.verdict !== 'supported')) {
      groundingFailures.push('fde_claim_not_supported_by_injected_evidence');
    }
    if (!usedGrounding && (!statesInsufficiency || !proposesValidation)) {
      groundingFailures.push('fde_requires_insufficiency_and_validation');
    }
    forbidPattern('automatic_plm_qms_writeback_or_approval', /(?:会|可以|可|支持|将|能够|直接).{0,12}自动(?:审批|批准|写回|写入|更新|创建)|auto(?:matically)?\s+(?:approve|write|update|create)|will\s+write\s*back|can\s+write\s*back/i);
    forbidPattern('invented_business_system_state', /(?:Windchill|PLM|QMS|CAPA|NCR|ECO|ECN|BOM).{0,24}(?:已发布|已审批|审批完成|已关闭|released|approved|closed|version|版本)/i);
    forbidUnpromptedTechnicalJargon(answer, input.sourceUtterance, forbiddenPatternFailures);
    enforceCapabilityFitLength(answer, requiredPatternFailures);
  }

  if (input.actionType === 'candidate_concern') {
    const usedPolicyGrounding = hasUsedGrounding(['material', 'pptx']);
    const statesInsufficiency = /招聘材料不足|材料不足|不能确认|无法确认|not enough|cannot confirm/i.test(answer);
    const requestsConfirmation = /招聘负责人|hiring team|recruiter|核实|确认|verify|confirm/i.test(answer);
    if (containsPositiveRecruitingPolicyClaim(answer) &&
      (!usedPolicyGrounding || input.claimGrounding?.verdict !== 'supported')) {
      groundingFailures.push('recruiting_policy_claim_not_supported_by_material');
    }
    if (!usedPolicyGrounding && (!statesInsufficiency || !requestsConfirmation)) {
      groundingFailures.push('candidate_concern_requires_insufficiency_and_confirmation');
    }
    forbidRecruitingMethodClassification(forbidPattern);
    forbidRecruitingFinalJudgments(forbidPattern);
  }

  if (input.actionType === 'candidate_evidence_summary') {
    requirePattern('evidence_observed_structure', /已观察证据|evidence observed/i);
    requirePattern('missing_or_needs_verification_structure', /缺失|待验证|missing|needs verification/i);
    if (!hasTranscriptEvidenceAnchors(answer, input.transcriptEvidence)) {
      groundingFailures.push('candidate_evidence_summary_requires_transcript_anchor');
    }
    forbidRecruitingMethodClassification(forbidPattern);
    forbidRecruitingFinalJudgments(forbidPattern);
  }

  if (input.actionType === 'discovery_question') {
    const questionCount = countQuestionLikeSentences(answer);
    if (questionCount < 1 || questionCount > 3) {
      requiredPatternFailures.push('discovery_question_count_1_to_3');
    }
    if (!containsOnlyQuestions(answer)) {
      requiredPatternFailures.push('discovery_only_questions');
    }
    forbidPattern('discovery_capability_claim', /我们支持|我们可以|产品能够|一定支持|保证支持|fully support|we support|we can support|our product can/i);
    forbidPattern('discovery_invented_case_or_roi', /Fortune\s*500|世界500强|标杆客户|ROI\s*(至少|guarantee|>|超过|都|很高|\d)|\d+\s*%|\$|¥|人民币|USD|CNY/i);
    if (questionCount === 0) {
      requiredPatternFailures.push('discovery_question_shape');
    }
    const anchors = extractAnchorTerms(input.sourceUtterance);
    if (anchors.length > 0 && !anchors.some((term) => answer.toLocaleLowerCase().includes(term.toLocaleLowerCase()))) {
      requiredPatternFailures.push('discovery_source_anchor');
    }
    const intentDirectionFailure = evaluateDiscoveryIntentDirection(input.sourceIntent, answer);
    if (intentDirectionFailure) {
      requiredPatternFailures.push(intentDirectionFailure);
    }
  }

  if (input.actionType === 'technical_requirements') {
    requirePattern('checklist_shape', /(^|\n)\s*[-*]\s*(API|SSO|Environment|Validation|Auth|安全|环境|验证)/i);
    forbidPattern('capability_promise', /一定支持|保证支持|guarantee|fully support all|所有.*都支持/i);
    const hasFailedBusinessContext = (input.groundedSources ?? []).some((source) =>
      source.type === 'business_context' && ['failed', 'not_found', 'scope_denied'].includes(source.status)
    );
    if (hasFailedBusinessContext && /Windchill|PLM|part\s*\d+|物料\s*\d+|Released|已发布/i.test(answer)) {
      groundingFailures.push('business_context_fact_requires_used_source');
    }
    forbidPattern('business_system_writeback_promise', /update.*automatically|auto.*write|写入|自动更新|自动写回|approve|审批通过后自动/i);
  }

  if (input.actionType === 'buying_signal') {
    const missing = new Set(input.missingFields ?? []);
    const asksForMissing = /(owner|负责人).*(date|时间|日期).*(artifact|产物|材料)|需要确认.*(owner|负责人|date|artifact|产物)/i.test(answer);
    if (!/\bOwner\s*[:：]|负责人\s*[:：]/i.test(answer) && !asksForMissing) missingFieldFailures.push('owner');
    if (!/\bDate\s*[:：]|\bDue\s*[:：]|日期\s*[:：]|时间\s*[:：]/i.test(answer) && !asksForMissing) missingFieldFailures.push('date');
    if (!/\bArtifact\s*[:：]|产物\s*[:：]|材料\s*[:：]/i.test(answer) && !asksForMissing) missingFieldFailures.push('artifact');
    if (missing.size > 0 && !asksForMissing && missingFieldFailures.length > 0) {
      missingFieldFailures.push('missing_fields_not_asked');
    }
  }

  return {
    passed:
      requiredPatternFailures.length === 0 &&
      forbiddenPatternFailures.length === 0 &&
      groundingFailures.length === 0 &&
      missingFieldFailures.length === 0,
    requiredPatternFailures,
    forbiddenPatternFailures,
    groundingFailures,
    missingFieldFailures,
  };
}

export function containsPositiveCapabilityClaim(answer: string): boolean {
  return /可以确认|确认支持|支持|能够|具备|can confirm|supports?|is supported|we can/i.test(answer);
}

export function containsPositiveRecruitingPolicyClaim(answer: string): boolean {
  return /远程办公|混合办公|签证(?:转移|支持)?|搬迁|薪酬|工资|薪资|(?:[一二三四五六七八九十]|1[0-2]|0?[1-9])月(?:份)?入职|(?:发放|发送|提供)(?:录用通知|\s*offer)|录用通知|\b(?:can|will)\s+(?:start|begin)\s+in\s+(?:january|february|march|april|may|june|july|august|september|october|november|december)\b|\b(?:can|will)\s+(?:issue|send|extend|make)\s+(?:an\s+)?offer\b|\b(?:职级|入职日期|start date|remote(?: work)?|hybrid|visa|relocation|compensation|salary|level)\b/i.test(answer);
}

export function buildCapabilityFitSafeFallback(language?: string): string {
  return language === 'en'
    ? 'The current materials are not enough to confirm this capability. Please verify it against the capability matrix or run a PoC with one real object and acceptance metric; no automatic PLM or QMS writeback is assumed.'
    : '当前资料不足，不能确认这项能力。建议补充产品能力材料，或用一个真实对象和验收指标做 PoC；这里不承诺自动写回 PLM 或 QMS。';
}

export function buildFdeGroundedAnswerSafeFallback(language?: string): string {
  return language === 'en'
    ? 'The current material is not enough to confirm this process or AI capability. AI can only be treated as a process check or prompt after validation, with key approvals kept under human confirmation. Validate it with one real process sample, test data, owner, human confirmation point, and acceptance criteria; no automatic PLM or QMS writeback is assumed.'
    : '当前资料不足，不能确认这个流程或 AI 能力。AI 只能在验证后作为流程检查或提示辅助，关键审批仍需人审。建议用一个真实流程样本、测试数据、负责人、人审点和验收标准做验证；这里不承诺自动写回 PLM 或 QMS。';
}

export function buildRecruitingPolicySafeFallback(language?: string): string {
  return language === 'en'
    ? 'The current recruiting materials are not enough to confirm this policy. Please verify it with the recruiter or hiring team before sharing a commitment.'
    : '当前招聘材料不足，不能确认这项政策。建议先向招聘负责人或 hiring team 核实后再回复候选人。';
}

export function buildRecruitingEvidenceSafeFallback(language?: string): string {
  return language === 'en'
    ? 'The current answer does not provide enough verifiable job-related evidence. Record only what was observed and mark the missing evidence for follow-up; do not make a hiring decision from this answer.'
    : '当前回答还没有提供足够的可验证岗位证据。请只记录已观察事实，并把缺失证据标为待追问；不要据此作出录用或淘汰判断。';
}

function forbidRecruitingMethodClassification(
  forbidPattern: (label: string, pattern: RegExp) => void,
): void {
  forbidPattern('visible_interview_method_classification', /(?:当前|这是|按|属于).{0,12}(?:STAR|BEI|结构化面试|压力面试)|(?:STAR|BEI).{0,12}(?:分类|classif)|\b(?:this is|currently)\s+(?:a\s+)?stress interview\b/i);
}

function forbidRecruitingFinalJudgments(
  forbidPattern: (label: string, pattern: RegExp) => void,
): void {
  forbidPattern('final_hiring_judgment_or_ranking', /不建议(?:继续)?推进|建议(?:立即)?(?:录用|淘汰)|(?:录用|淘汰|拒绝)候选人|排名|最(?:强|佳)候选人|\b(?:i|we)\s+(?:do not|don't)\s+recommend\s+(?:proceeding|moving forward|continuing)\b|must hire|hire immediately|reject candidate|top candidate/i);
  forbidPattern('protected_class_basis', /性别|年龄|民族|种族|宗教|婚姻|怀孕|残障|gender|age|race|religion|disability|marital/i);
  forbidPattern('aggressive_recruiting_pressure', /必须(?:马上|立即)(?:录用|接受)|强烈建议(?:马上|立即)?录用|逼迫|施压|pressure.*(?:accept|hire)/i);
}

function hasTranscriptEvidenceAnchors(answer: string, transcriptEvidence: string[] | undefined): boolean {
  const evidenceSegments = extractEvidenceSegments(answer);
  const transcriptAnchors = new Set(
    (transcriptEvidence ?? []).flatMap(extractJobRelatedAnchors),
  );
  return evidenceSegments.length > 0 && transcriptAnchors.size > 0 && evidenceSegments.every((segment) => {
    const anchors = extractJobRelatedAnchors(segment);
    return anchors.length > 0 && anchors.some((anchor) => transcriptAnchors.has(anchor));
  });
}

function extractEvidenceSegments(answer: string): string[] {
  const observedMatch = answer.match(/(?:已观察证据|evidence observed)\s*[:：]?\s*([\s\S]*?)(?=(?:缺失|待验证|missing|needs verification)\s*[:：]?|$)/i);
  return observedMatch?.[1]
    .split(/[。.!！；;\n]+/)
    .map((segment) => segment.replace(/^(?:结果|result)\s*[:：]?\s*/i, '').trim())
    .filter(Boolean) ?? [];
}

function extractJobRelatedAnchors(value: string): string[] {
  const normalized = value.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
  const ignored = new Set([
    '候选人', '候选', '选人', '已观察', '观察证据', '证据', '结果', '待验证', '缺失', '自己',
    'candidate', 'evidence', 'observed', 'result', 'missing', 'verification', 'needs',
  ]);
  const anchors = new Set<string>();
  for (const token of normalized.match(/[a-z][a-z0-9_-]{1,}|\d+(?:\.\d+)?|[\p{Script=Han}]{2,}/gu) ?? []) {
    if (/^[\p{Script=Han}]{2}$/u.test(token)) {
      if (!ignored.has(token)) anchors.add(token);
      continue;
    }
    if (/^[\p{Script=Han}]{3,}$/u.test(token)) {
      for (let index = 0; index <= token.length - 2; index += 1) {
        const anchor = token.slice(index, index + 2);
        if (!ignored.has(anchor)) anchors.add(anchor);
      }
      continue;
    }
    if (/^[\p{Script=Han}]+$/u.test(token)) {
      for (let size = 2; size <= Math.min(4, token.length); size += 1) {
        for (let index = 0; index <= token.length - size; index += 1) {
          const anchor = token.slice(index, index + size);
          if (!ignored.has(anchor)) anchors.add(anchor);
        }
      }
      continue;
    }
    if (!ignored.has(token)) anchors.add(token);
  }
  return [...anchors];
}

function forbidUnpromptedTechnicalJargon(answer: string, sourceUtterance: string | undefined, failures: string[]): void {
  const jargonPattern = /\b(?:LLM|RAG|tool call|agent orchestration|embedding)\b/i;
  if (!jargonPattern.test(answer)) return;
  if (!jargonPattern.test(String(sourceUtterance || ''))) {
    failures.push('unprompted_ai_technical_jargon');
  }
}

function enforceCapabilityFitLength(answer: string, failures: string[]): void {
  const cjkChars = answer.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const words = answer.trim().split(/\s+/).filter(Boolean).length;
  if ((cjkChars > 0 && cjkChars > 180) || (cjkChars === 0 && words > 120)) {
    failures.push('capability_fit_answer_too_long');
  }
}

function countQuestionLikeSentences(answer: string): number {
  const explicitQuestionMarks = answer.match(/[?？]/g)?.length ?? 0;
  if (explicitQuestionMarks > 0) return explicitQuestionMarks;
  return answer
    .split(/[\n。！？!?]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) =>
      /^(?:[-*]\s*)?(?:您|你|贵司|团队|现在|当前|这个|这类|谁|什么|哪些|哪一|如何|能否|是否|有没有|what|which|who|how|can|could|would|does|do)/i.test(part) ||
      /(?:吗|么|呢)$/.test(part)
    ).length;
}

function containsOnlyQuestions(answer: string): boolean {
  const segments = splitAnswerSegments(answer);
  return segments.length > 0 && segments.every(isQuestionLikeSegment);
}

function splitAnswerSegments(answer: string): string[] {
  return answer
    .split(/(?<=[?？。.!！])|\n+/)
    .map((part) => part.replace(/^[-*\d.、)\s]+/, '').trim())
    .filter(Boolean);
}

function isQuestionLikeSegment(segment: string): boolean {
  return /[?？]$/.test(segment) ||
    /^(?:您|你|贵司|团队|现在|当前|这个|这类|谁|什么|哪些|哪一|如何|能否|是否|有没有|what|which|who|how|can|could|would|does|do)/i.test(segment) ||
    /(?:吗|么|呢)$/.test(segment);
}

function evaluateDiscoveryIntentDirection(sourceIntent: string | undefined, answer: string): string | undefined {
  if (!sourceIntent) return undefined;
  const directionPatterns: Record<string, RegExp> = {
    sales_pain_discovery: /流程|断点|缺口|workaround|补|谁|影响|impact|痛点|现状/i,
    sales_capability_fit: /目标工作流|工作流|对象|验收|验证|标准|acceptance|validation|workflow|fit|适合/i,
    sales_process_integration: /源系统|目标系统|数据方向|读写边界|边界|owner|负责|source system|target system|data direction|handoff/i,
    sales_value_discovery: /周期|成本|质量|审计|返工|效率|成功指标|metric|cycle time|cost|rework|audit|success/i,
    sales_contextual_proof_discovery: /行业|流程|系统组合|数据对象|成功指标|case|proof|ROI|类似|案例|证明|metric/i,
  };
  const pattern = directionPatterns[sourceIntent];
  if (!pattern) return undefined;
  return pattern.test(answer) ? undefined : `discovery_intent_direction_${sourceIntent}`;
}

function extractAnchorTerms(sourceUtterance?: string): string[] {
  const source = String(sourceUtterance || '');
  if (!source.trim()) return [];
  const anchorPatterns = [
    /\b(?:PLM|Windchill|QMS|ERP|SAP|Oracle|MES|ALM|Creo|CAD|BOM|ECO|ECN|CAPA|NCR|8D|AI Agent|Agent)\b/gi,
    /(?:图纸|物料|变更|工艺|工单|质量|审计|仿真|流体仿真|力学仿真|装配|测试用例|缺陷|需求追踪|追踪矩阵|流道|冷却液)/g,
    /(?:质量经理|工程师|审计员|采购|法务|工艺员|设计师|测试经理|产品经理|quality manager|auditor|engineer|buyer|procurement)/gi,
    /(?:审计通过率|关闭周期|周期|良率|返工率|成本|质量成本|效率|评审效率|交付周期|cycle time|yield|rework rate|cost|audit pass rate)/gi,
  ];
  const anchors = new Set<string>();
  for (const pattern of anchorPatterns) {
    for (const match of source.matchAll(pattern)) {
      const value = match[0]?.trim();
      if (value) anchors.add(value);
    }
  }
  return Array.from(anchors);
}
