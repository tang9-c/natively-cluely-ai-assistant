export interface FdeAcceptedOutputEvaluationInput {
  actionType: string;
  answerText: string;
  missingFields: string[];
  groundedSources: Array<{ type: string; status: string }>;
}

export function evaluateFdeAcceptedOutput(input: FdeAcceptedOutputEvaluationInput): { passed: boolean; failures: string[] } {
  const text = input.answerText.trim();
  const failures: string[] = [];
  if (!text) failures.push('empty_answer');
  if (text.length > 180 && /[\u4e00-\u9fff]/.test(text)) failures.push('answer_too_long_zh');
  if (text.split(/\s+/).length > 120 && !/[\u4e00-\u9fff]/.test(text)) failures.push('answer_too_long_en');
  if (/自动(?:审批|写入|更新|创建)|auto(?:matically)? (?:approve|write|update|create)|write back/i.test(text)) failures.push('no_writeback_boundary');

  if (input.actionType === 'fde_discovery_probe') {
    const questionCount = (text.match(/[?？]/g) ?? []).length;
    if (questionCount < 3) failures.push('missing_three_questions');
    if (!/(ECO|ECN|BOM|CAPA|NCR|8D|PLM|QMS|权限|流程|质量|变更)/i.test(text)) failures.push('missing_manufacturing_context');
  }

  if (/fde_(next_step|success_criteria|integration_check)/.test(input.actionType)) {
    for (const field of ['owner', 'date', 'artifact']) {
      if (!mentionsField(text, field) && !input.missingFields.includes(field)) failures.push(`missing_${field}`);
    }
  }

  if (/fde_(next_step|success_criteria)/.test(input.actionType)) {
    if (!/(test data|测试数据|真实 ECO|真实 CAPA|样本数据)/i.test(text) && !input.missingFields.includes('test_data')) failures.push('missing_test_data');
    if (!/(acceptance criteria|验收标准|准确率|权限边界|审计可追溯)/i.test(text) && !input.missingFields.includes('acceptance_criteria')) failures.push('missing_acceptance_criteria');
  }

  if (input.actionType === 'fde_risk_blocker') {
    for (const phrase of ['客户流程风险', '系统权限风险', '我们交付风险', 'AI Agent 误判风险', '信息缺失']) {
      if (!text.includes(phrase)) failures.push(`missing_${phrase}`);
    }
  }

  if (input.actionType === 'fde_agent_feasibility') {
    if (!/(人工确认|human confirmation|人审)/i.test(text)) failures.push('missing_human_confirmation');
    if (!/(只读|read-only|不可自动化|不可自动写入|no writeback)/i.test(text)) failures.push('missing_automation_boundary');
  }

  if (input.groundedSources.length === 0) failures.push('missing_grounding');
  if (input.groundedSources.some((source) => source.type === 'business_context' && ['failed', 'not_found'].includes(source.status))) {
    if (/(已经审批完成|已发布|已关闭|version|版本|状态是|state is|released|approved)/i.test(text)) failures.push('ungrounded_business_fact');
  }

  return { passed: failures.length === 0, failures };
}

function mentionsField(text: string, field: string): boolean {
  if (field === 'owner') return /\bowner\b|负责人|谁负责/i.test(text);
  if (field === 'date') return /\bdate\b|deadline|截止|日期|什么时候|周[一二三四五六日天]/i.test(text);
  if (field === 'artifact') return /\bartifact\b|验证产物|验证材料|交付物|样本/i.test(text);
  return false;
}
