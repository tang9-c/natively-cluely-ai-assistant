export function evaluateTeamMeetingAcceptedOutput(input: {
  actionType: string;
  answerText: string;
  missingFields: string[];
}): { passed: boolean; failures: string[] } {
  const text = input.answerText.trim();
  const failures: string[] = [];
  if (!text) failures.push('empty_answer');

  if (input.actionType === 'action_item' || input.actionType === 'owner_deadline_check') {
    if (!/(owner|负责人)/i.test(text) && !input.missingFields.includes('owner')) failures.push('missing_owner');
    if (!/(deliverable|交付物|task|任务|checklist)/i.test(text) && !input.missingFields.includes('deliverable')) failures.push('missing_deliverable');
    if (!/(due|deadline|截止|周[一二三四五六日天]|Friday|Monday)/i.test(text) && !input.missingFields.includes('due_date')) failures.push('missing_due_date');
  }

  if (input.actionType === 'decision_point') {
    if (!/(decision|决定)/i.test(text)) failures.push('missing_decision');
    if (!/(rationale|原因|依据)/i.test(text)) failures.push('missing_rationale');
    if (!/(reversibility|可逆|回滚|不可逆)/i.test(text)) failures.push('missing_reversibility');
  }

  if (input.actionType === 'blocker_check') {
    if (!/(blocker|阻塞)/i.test(text)) failures.push('missing_blocker');
    if (!/(impact|影响)/i.test(text)) failures.push('missing_impact');
    if (!/(dependency|依赖)/i.test(text)) failures.push('missing_dependency');
    if (!/(next unblock step|解阻|下一步)/i.test(text)) failures.push('missing_unblock_step');
  }

  return { passed: failures.length === 0, failures };
}
