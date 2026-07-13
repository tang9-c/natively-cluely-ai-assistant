import type { DynamicActionOutputType } from './DynamicAction';
import type { ActionArtifact } from './DynamicActionArtifacts';

export interface AcceptedOutputEvaluationInput {
  actionType: string;
  outputType: DynamicActionOutputType;
  answerText: string;
  groundedSources?: ActionArtifact['groundedSources'];
  missingFields?: string[];
  sourceUtterance?: string;
  sourceIntent?: string;
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

  if (input.actionType === 'discovery_question') {
    const questionCount = countQuestionLikeSentences(answer);
    if (questionCount < 1 || questionCount > 3) {
      requiredPatternFailures.push('discovery_question_count_1_to_3');
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
