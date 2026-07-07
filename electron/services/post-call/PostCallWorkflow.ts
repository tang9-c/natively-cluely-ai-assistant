import type { ActionArtifact } from '../dynamic-actions/DynamicActionArtifacts';

export type PostCallModeType =
  | 'general'
  | 'looking-for-work'
  | 'sales'
  | 'recruiting'
  | 'team-meet'
  | 'lecture'
  | 'technical-interview'
  | string;

export interface PostCallTranscriptSegment {
  speaker: string;
  text: string;
  timestamp: number;
}

export interface StructuredActionItem {
  id: string;
  text: string;
  owner?: string;
  deadline?: string;
  sourceTimestamp?: number;
}

export interface CoachingInsight {
  id: string;
  type: string;
  title: string;
  detail: string;
  severity: 'info' | 'opportunity' | 'warning';
  evidence?: string;
}

export interface PostCallEnhancements {
  schemaVersion: 2;
  actionItemsStructured: StructuredActionItem[];
  followUpDraft: string;
  coachingInsights: CoachingInsight[];
}

const ACTION_PATTERNS = [
  /\b(?:i|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must|can|could)\s+(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /\b(?:action|todo|follow up):\s*(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /\b(?:send|share|schedule|book|prepare|review|follow up|circle back|introduce|email)\s+(.+?)(?:\s+(?:by|before|on|after)\s+([^.!?]+))?[.!?]?$/i,
  /(?:下一步|后续|会后)?(?:请|麻烦|需要|可以)?(?:你们|我们|我)?\s*(发(?:一个)?案例和报价单|发(?:一个)?案例|发报价单|发送案例和报价单|发送案例|发送报价单|安排时间看合同|安排时间|跟进合同|发合同)(?:[，,。.!；;]|$)/u,
];

const OWNER_PATTERN = /\b(I|we|you|he|she|they|[A-Z][a-z]+)\s+(?:will|should|need to|needs to|must|can|could)\b/;
const DEADLINE_PATTERN = /\b(?:by|before|on|after)\s+([^.!?]+)$/i;
const ZH_DEADLINE_PATTERN = /(今天|明天|后天|本周|下周|周[一二三四五六日天]|星期[一二三四五六日天]|月底|季度末)前?/u;
const SALES_OBJECTION_PATTERN = /\b(price|pricing|cost|expensive|competitor|budget|too much|not sure)\b|(?:价格|报价|预算|成本|费用|太贵|竞品|竞争对手|不确定)/i;
const SALES_NEXT_STEP_PATTERN = /\b(next step|follow up|send|schedule|pilot|trial|contract|proposal)\b|(?:下一步|跟进|发送|发|安排|试点|试用|合同|报价单|方案|案例)/i;
const RECRUITING_LOGISTICS_PATTERN = /\b(compensation|salary|timeline|notice period|availability|start date)\b|(?:薪资|签证|入职时间|搬迁|远程|混合办公|offer|JD|岗位)/i;
const TEAM_OWNERSHIP_PATTERN = /\b(owner|by|deadline|due|next step|action item)\b|(?:负责人|我来负责|我负责|我来做|行动项|截止|周[一二三四五六日天]前|星期[一二三四五六日天]前)/i;
const TEAM_DECISION_PATTERN = /\b(decided|approved|confirmed|final decision)\b|(?:决定|就选|我们定|最终决定|批准|确认|通过)/i;
const TEAM_RISK_PATTERN = /\b(blocker|blocked|risk|dependency|behind schedule)\b|(?:风险|阻塞|依赖|延期|卡住|影响进度)/i;
const LECTURE_STUDY_PATTERN = /\b(homework|assignment|read|chapter|due|exam|quiz)\b|(?:作业|阅读|章节|第[一二三四五六七八九十\d]+章|考试|测验|例题)/i;
const INTERVIEW_UNCERTAINTY_PATTERN = /\b(i don'?t know|not sure|maybe|i think)\b|(?:不确定|不会|不太会|没有把握|需要优化|复杂度|补(?:一个)?项目例子)/i;
const FDE_GOAL_PATTERN = /\b(goal|business goal|success metric|KPI|ROI|outcome)\b|(?:目标|业务目标|成功标准|成功指标|业务结果|希望达到)/i;
const FDE_SUCCESS_METRIC_PATTERN = /\b(success metric|KPI|measure|target|baseline)\b|(?:成功指标|基线|目标值|指标)/i;
const FDE_INTEGRATION_PATTERN = /\b(API|integration|CRM|Salesforce|HubSpot|SSO|SAML|OAuth|webhook|database|warehouse|Slack)\b|(?:集成|接口|数据源|权限|同步|数据库|第一阶段接)/i;
const FDE_SECURITY_PATTERN = /\b(PII|SOC2|HIPAA|GDPR|security|privacy|audit|compliance|data residency)\b|(?:安全|隐私|敏感数据|审计|合规|脱敏|数据驻留|日志)/i;
const FDE_SCOPE_CHANGE_PATTERN = /\b(also|additionally|phase|nice to have|scope)\b|(?:顺便|能不能也|另外还要|第一阶段|第二阶段|范围|优先级)/i;
const FDE_NEXT_STEP_PATTERN = /\b(next step|owner|deadline|pilot|POC|prototype|validation|validate|prepare)\b|(?:下一步|负责人|截止|试点|原型|验证|会后)/i;
const FDE_EMOTION_PATTERN = /\b(worried|concerned|frustrated|skeptical|urgent|deadline|excited|hesitant)\b|(?:担心|怕|太慢|出错|确定吗|真的吗|月底前|老板在催|很有用|再看看)/i;

export function buildPostCallEnhancements(params: {
  transcript: PostCallTranscriptSegment[];
  modeTemplateType?: PostCallModeType | null;
  summaryData?: { overview?: string; actionItems?: string[]; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> };
  dynamicActionArtifacts?: ActionArtifact[];
}): PostCallEnhancements {
  const extractedActionItems = extractStructuredActionItems(params.transcript, params.summaryData?.actionItems ?? []);
  const actionItemsStructured = params.dynamicActionArtifacts?.length
    ? mergeAcceptedActionArtifacts(extractedActionItems, params.dynamicActionArtifacts)
    : extractedActionItems;
  const coachingInsights = generateCoachingInsights(
    params.transcript,
    params.modeTemplateType,
    params.summaryData,
    params.dynamicActionArtifacts,
  );

  return {
    schemaVersion: 2,
    actionItemsStructured,
    followUpDraft: buildFollowUpDraft(params.modeTemplateType, actionItemsStructured, params.summaryData),
    coachingInsights,
  };
}

export function extractStructuredActionItems(
  transcript: PostCallTranscriptSegment[],
  summaryActionItems: string[] = []
): StructuredActionItem[] {
  const items: StructuredActionItem[] = [];
  const seen = new Set<string>();

  const addItem = (text: string, sourceTimestamp?: number, owner?: string, deadline?: string) => {
    const cleaned = normalizeActionText(text);
    if (!cleaned) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    items.push({
      id: `action_${items.length + 1}`,
      text: cleaned,
      ...(owner ? { owner } : {}),
      ...(deadline ? { deadline: deadline.trim() } : {}),
      ...(typeof sourceTimestamp === 'number' ? { sourceTimestamp } : {}),
    });
  };

  for (const segment of transcript) {
    const text = segment.text.trim();
    if (!text) continue;

    for (const pattern of ACTION_PATTERNS) {
      const match = text.match(pattern);
      if (!match) continue;
      const owner = text.match(OWNER_PATTERN)?.[1];
      const deadline = match[2] ?? text.match(DEADLINE_PATTERN)?.[1] ?? text.match(ZH_DEADLINE_PATTERN)?.[0];
      addItem(match[1] ?? text, segment.timestamp, normalizeOwner(owner), deadline);
      break;
    }

    for (const phrase of extractChineseActionPhrases(text)) {
      addItem(phrase, segment.timestamp, undefined, text.match(ZH_DEADLINE_PATTERN)?.[0]);
    }
  }

  for (const item of summaryActionItems) {
    addItem(item);
  }

  return items.slice(0, 8);
}

export function buildFollowUpDraft(
  modeTemplateType: PostCallModeType | null | undefined,
  actionItems: StructuredActionItem[],
  summaryData?: { overview?: string; keyPoints?: string[]; sections?: Array<{ title: string; bullets: string[] }> }
): string {
  const greeting = modeTemplateType === 'sales' || modeTemplateType === 'recruiting' || modeTemplateType === 'fde'
    ? 'Hi,'
    : 'Hi team,';
  const lines = [greeting, '', 'Thanks for the conversation today.'];

  if (summaryData?.overview) {
    lines.push('', summaryData.overview.trim());
  }

  const nextSteps = actionItems.map(item => {
    const owner = item.owner ? `${item.owner}: ` : '';
    const deadline = item.deadline ? ` by ${item.deadline}` : '';
    return `- ${owner}${item.text}${deadline}`;
  });

  if (nextSteps.length > 0) {
    lines.push('', 'Next steps:', ...nextSteps);
  }

  if (nextSteps.length === 0) {
    lines.push('', 'I will follow up if anything else is needed.');
  }

  lines.push('', 'Best,');
  return lines.join('\n');
}

export function generateCoachingInsights(
  transcript: PostCallTranscriptSegment[],
  modeTemplateType: PostCallModeType | null | undefined,
  summaryData?: { sections?: Array<{ title: string; bullets: string[] }> },
  dynamicActionArtifacts?: ActionArtifact[],
): CoachingInsight[] {
  const text = transcript.map(segment => segment.text).join('\n');
  const insights: CoachingInsight[] = [];

  const add = (type: string, title: string, detail: string, severity: CoachingInsight['severity'], evidence?: string) => {
    insights.push({ id: `coach_${insights.length + 1}`, type, title, detail, severity, ...(evidence ? { evidence } : {}) });
  };

  if (modeTemplateType === 'sales') {
    const hasObjection = SALES_OBJECTION_PATTERN.test(text);
    const hasNextStep = SALES_NEXT_STEP_PATTERN.test(text);
    if (hasObjection && !sectionHasContent(summaryData, 'Objections')) {
      add('missed_objection', 'Objection may need a clearer note', 'The conversation included objection language, but the objection section is empty.', 'opportunity', firstMatch(text, /[^。！？.!?]*(?:price|pricing|cost|expensive|competitor|budget|too much|not sure|价格|报价|预算|成本|费用|太贵|竞品|竞争对手|不确定)[^。！？.!?]*/i));
    }
    if (!hasNextStep) {
      add('missing_next_step', 'Next step was not explicit', 'Consider ending sales calls with a concrete owner and follow-up date.', 'opportunity');
    }
  } else if (modeTemplateType === 'recruiting') {
    if (!RECRUITING_LOGISTICS_PATTERN.test(text)) {
      add('missing_logistics', 'Recruiting logistics not captured', 'Consider confirming compensation, timing, and availability before closing the screen.', 'opportunity');
    }
  } else if (modeTemplateType === 'looking-for-work' || modeTemplateType === 'technical-interview') {
    if (INTERVIEW_UNCERTAINTY_PATTERN.test(text)) {
      add('uncertainty_pattern', 'Uncertainty appeared in answers', 'Review these moments and prepare a tighter explanation or fallback answer.', 'info', firstMatch(text, /[^。！？.!?]*(?:i don'?t know|not sure|maybe|i think|不确定|不会|不太会|没有把握|需要优化|复杂度|补(?:一个)?项目例子)[^。！？.!?]*/i));
    }
  } else if (modeTemplateType === 'fde') {
    const hasGoal = FDE_GOAL_PATTERN.test(text);
    const hasSuccessMetric = FDE_SUCCESS_METRIC_PATTERN.test(text);
    const hasIntegration = FDE_INTEGRATION_PATTERN.test(text);
    const hasNextStep = FDE_NEXT_STEP_PATTERN.test(text);

    if (hasGoal && !hasSuccessMetric) {
      add('missing_success_metric', 'Success metric may be unclear', 'The customer stated a goal, but no measurable success metric was captured.', 'opportunity');
    }
    if (hasIntegration && !hasNextStep) {
      add('missing_integration_owner', 'Integration follow-up may need an owner', 'The conversation included systems or integration work, but no validation owner or next step was explicit.', 'opportunity');
    }
    if (FDE_SECURITY_PATTERN.test(text)) {
      add('security_risk_captured', 'Security or compliance signal captured', 'The customer raised a security, privacy, or compliance concern that should be tracked through delivery.', 'info', firstMatch(text, /[^。！？.!?]*(?:PII|SOC2|HIPAA|GDPR|security|privacy|audit|compliance|data residency|安全|隐私|敏感数据|审计|合规|脱敏|数据驻留|日志)[^。！？.!?]*/i));
    }
    if (FDE_SCOPE_CHANGE_PATTERN.test(text)) {
      add('scope_change_detected', 'Scope change signal detected', 'The customer introduced possible additional scope. Confirm priority and phase before committing.', 'opportunity', firstMatch(text, /[^。！？.!?]*(?:also|additionally|phase|nice to have|scope|顺便|能不能也|另外还要|第一阶段|第二阶段|范围|优先级)[^。！？.!?]*/i));
    }
    if (!hasNextStep) {
      add('missing_delivery_next_step', 'Delivery next step was not explicit', 'FDE meetings should end with a concrete validation step, owner, and expected artifact.', 'opportunity');
    }
    if (FDE_EMOTION_PATTERN.test(text)) {
      add('emotion_signal_detected', 'Customer emotion signal detected', 'The customer expressed concern, frustration, urgency, skepticism, excitement, or hesitation. Reflect this in the follow-up and risk plan.', 'info');
    }
  } else if (modeTemplateType === 'team-meet') {
    if (TEAM_DECISION_PATTERN.test(text)) {
      add('decision_captured', 'Decision captured', 'The conversation included a decision signal.', 'info', firstMatch(text, /[^。！？.!?]*(?:decided|approved|confirmed|final decision|决定|就选|我们定|最终决定|批准|确认|通过)[^。！？.!?]*/i));
    }
    if (TEAM_RISK_PATTERN.test(text)) {
      add('risk_captured', 'Risk or blocker captured', 'The conversation included a risk, blocker, or dependency signal.', 'info', firstMatch(text, /[^。！？.!?]*(?:blocker|blocked|risk|dependency|behind schedule|风险|阻塞|依赖|延期|卡住|影响进度)[^。！？.!?]*/i));
    }
    if (!TEAM_OWNERSHIP_PATTERN.test(text)) {
      add('missing_ownership', 'Ownership may be unclear', 'Team meetings are more useful when decisions include owners and dates.', 'opportunity');
    }
    if (hasCompletedAcceptedTeamActionArtifact(dynamicActionArtifacts)) {
      add('accepted_dynamic_action', 'Accepted meeting action preserved', 'A meeting action accepted during the call was carried into the post-call notes.', 'info');
    }
  } else if (modeTemplateType === 'lecture') {
    if (LECTURE_STUDY_PATTERN.test(text)) {
      add('study_follow_up', 'Study follow-up detected', 'Add the assignment or study item to follow-up work so it is not missed.', 'info', firstMatch(text, /[^。！？.!?]*(?:homework|assignment|read|chapter|due|exam|quiz|作业|阅读|章节|第[一二三四五六七八九十\d]+章|考试|测验|例题)[^。！？.!?]*/i));
    }
  }

  return insights.slice(0, 5);
}

function mergeAcceptedActionArtifacts(
  existing: StructuredActionItem[],
  artifacts: ActionArtifact[],
): StructuredActionItem[] {
  const merged = [...existing];
  const seen = new Set(existing.map((item) => normalizeActionComparisonKey(item.text)));

  for (const artifact of artifacts) {
    if (artifact.modeTemplateType !== 'team-meet') continue;
    if (!['action_item', 'owner_deadline_check'].includes(artifact.actionType)) continue;
    if (!isAcceptedTeamActionCarryoverStatus(artifact.generationStatus)) continue;

    const parsed = parseArtifactActionSummary(artifact.structuredSummary);
    if (!parsed.text) continue;

    const matchedExisting = merged.find((item) => actionItemMatchesArtifact(item, parsed));
    if (matchedExisting) {
      if (!matchedExisting.owner && parsed.owner) matchedExisting.owner = parsed.owner;
      if (!matchedExisting.deadline && parsed.deadline) matchedExisting.deadline = parsed.deadline;
      if (typeof matchedExisting.sourceTimestamp !== 'number') matchedExisting.sourceTimestamp = artifact.acceptedAt;
      continue;
    }

    const key = normalizeActionComparisonKey(parsed.text);
    if (!key || seen.has(key)) continue;
    if (merged.length >= 8) continue;
    seen.add(key);

    merged.push({
      id: `action_${merged.length + 1}`,
      text: parsed.text,
      ...(parsed.owner ? { owner: parsed.owner } : {}),
      ...(parsed.deadline ? { deadline: parsed.deadline } : {}),
      sourceTimestamp: artifact.acceptedAt,
    });
  }

  return merged;
}

function hasCompletedAcceptedTeamActionArtifact(artifacts?: ActionArtifact[]): boolean {
  return Boolean(artifacts?.some((artifact) =>
    artifact.modeTemplateType === 'team-meet' &&
    ['action_item', 'owner_deadline_check'].includes(artifact.actionType) &&
    isAcceptedTeamActionCarryoverStatus(artifact.generationStatus) &&
    Boolean(artifact.structuredSummary.trim()),
  ));
}

function isAcceptedTeamActionCarryoverStatus(status: ActionArtifact['generationStatus']): boolean {
  return status === 'completed' || status === 'generated_failed' || status === 'not_generated';
}

function parseArtifactActionSummary(summary: string): { text: string; owner?: string; deadline?: string } {
  const trimmed = summary.trim();
  if (!trimmed) return { text: '' };

  const lines = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const owner = lines.find((line) => /^(owner|负责人)\s*[:：]/i.test(line))?.replace(/^(owner|负责人)\s*[:：]/i, '').trim();
  const deliverable = lines.find((line) => /^(deliverable|task|交付物)\s*[:：]/i.test(line))?.replace(/^(deliverable|task|交付物)\s*[:：]/i, '').trim();
  const deadline = lines.find((line) => /^(due|deadline|截止时间)\s*[:：]/i.test(line))?.replace(/^(due|deadline|截止时间)\s*[:：]/i, '').trim();

  return {
    text: deliverable || trimmed.replace(/\s+/g, ' ').trim(),
    ...(owner ? { owner } : {}),
    ...(deadline ? { deadline } : {}),
  };
}

function actionItemMatchesArtifact(
  item: StructuredActionItem,
  parsedArtifact: { text: string; owner?: string; deadline?: string },
): boolean {
  const itemKey = normalizeActionComparisonKey(item.text);
  const artifactKey = normalizeActionComparisonKey(parsedArtifact.text);
  if (!itemKey || !artifactKey) return false;
  return containsWholeActionPhrase(itemKey, artifactKey) || containsWholeActionPhrase(artifactKey, itemKey);
}

function normalizeActionComparisonKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^(owner|deliverable|task|due|deadline|负责人|交付物|截止时间)\s*[:：]\s*/gim, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(?:i|we|me|will|can|could|should|need|to|the|a|an|by)\b/gi, ' ')
    .replace(/\b(?:owner|deliverable|due|deadline)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsWholeActionPhrase(value: string, candidate: string): boolean {
  if (value === candidate) return true;
  const paddedValue = ` ${value} `;
  const paddedCandidate = ` ${candidate} `;
  return paddedValue.includes(paddedCandidate);
}

function extractChineseActionPhrases(text: string): string[] {
  const phrases: string[] = [];
  const pushMatches = (pattern: RegExp) => {
    for (const match of text.matchAll(pattern)) {
      const phrase = (match[1] ?? match[0] ?? '').trim();
      if (phrase) phrases.push(phrase);
    }
  };

  pushMatches(/((?:这个任务|这件事|任务)?(?:我来负责|我负责|我来做|我会处理)[^，,。！？.!?；;]*)/gu);
  pushMatches(/(安排下一轮面试|安排面试|发\s?JD|发送\s?JD|发岗位\s?JD|发送岗位\s?JD)/giu);
  return phrases;
}

function normalizeActionText(value: string): string {
  return value
    .replace(/^\s*(?:action|todo|follow up):\s*/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.!?]+$/, '')
    .trim();
}

function normalizeOwner(owner?: string): string | undefined {
  if (!owner) return undefined;
  const normalized = owner.trim();
  if (/^i$/i.test(normalized)) return 'Me';
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function sectionHasContent(
  summaryData: { sections?: Array<{ title: string; bullets: string[] }> } | undefined,
  title: string
): boolean {
  return Boolean(summaryData?.sections?.some(section => section.title.toLowerCase() === title.toLowerCase() && section.bullets.length > 0));
}

function firstMatch(text: string, pattern: RegExp): string | undefined {
  return text.match(pattern)?.[0]?.trim();
}
