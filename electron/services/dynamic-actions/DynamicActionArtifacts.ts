import type { DynamicActionOutputType } from './DynamicAction';

export interface ActionArtifact {
  actionId: string;
  parentActionId?: string;
  modeTemplateType: 'sales' | 'fde' | 'recruiting' | 'team-meet';
  actionType: string;
  sourceIntent?: string;
  outputType: DynamicActionOutputType;
  structuredSummary: string;
  missingFields: string[];
  groundedSources: Array<{
    evidenceId?: string;
    type: 'material' | 'pptx' | 'screen' | 'business_context' | 'transcript';
    label: string;
    status: 'used' | 'not_found' | 'scope_denied' | 'failed';
  }>;
  acceptedAt: number;
  acceptTriggerSource?: 'manual' | 'auto_countdown';
  evaluationResult?: 'passed' | 'safe_fallback';
  generationStatus: 'completed' | 'generated_failed' | 'not_generated';
}

export interface BuildDynamicActionArtifactsInput {
  actions: Array<{
    id: string;
    modeTemplateType: string;
    type: string;
    productContract: { outputType: DynamicActionOutputType };
    status: string;
    createdAt: number;
    parentActionId?: string;
    sourceIntent?: string;
    latestTurn?: string;
    retrievalQuery?: string;
    triggerSource?: 'manual' | 'auto_countdown';
  }>;
  usage: Array<{
    question?: string;
    answer?: string | string[] | null;
    type?: string;
    timestamp?: number;
    metadata?: any;
  }>;
}

const ARTIFACT_MODES = new Set(['sales', 'fde', 'recruiting', 'team-meet']);

export function buildDynamicActionArtifacts(input: BuildDynamicActionArtifactsInput): ActionArtifact[] {
  // Dynamic action artifacts are transient post-call inputs, not a persisted database record.
  return input.actions
    .filter((action) => ARTIFACT_MODES.has(action.modeTemplateType))
    .filter((action) => ['accepted', 'auto_generated', 'completed', 'generated_failed'].includes(action.status))
    .map((action) => {
      const usage = findUsageForAction(action.id, action.createdAt, input.usage);
      const answer = normalizeAnswer(usage?.answer);
      const structuredSummary = answer || action.latestTurn || action.retrievalQuery || action.type;
      const acceptTriggerSource =
        normalizeAcceptTriggerSource(usage?.metadata?.triggerSource) ??
        normalizeAcceptTriggerSource(action.triggerSource);
      const sourceIntent =
        normalizeSourceIntent(usage?.metadata?.sourceIntent) ??
        normalizeSourceIntent(action.sourceIntent);
      return {
        actionId: action.id,
        ...((usage?.metadata?.parentActionId || action.parentActionId) ? {
          parentActionId: String(usage?.metadata?.parentActionId || action.parentActionId),
        } : {}),
        modeTemplateType: action.modeTemplateType as ActionArtifact['modeTemplateType'],
        actionType: action.type,
        ...(sourceIntent ? { sourceIntent } : {}),
        outputType: action.productContract.outputType,
        structuredSummary,
        missingFields: deriveMissingFields(action.modeTemplateType, action.type, structuredSummary),
        groundedSources: normalizeGroundedSources(usage?.metadata, structuredSummary),
        acceptedAt: action.createdAt,
        ...(acceptTriggerSource ? { acceptTriggerSource } : {}),
        ...(normalizeEvaluationResult(usage?.metadata?.evaluationResult) ? {
          evaluationResult: normalizeEvaluationResult(usage?.metadata?.evaluationResult),
        } : {}),
        generationStatus:
          action.status === 'generated_failed'
            ? 'generated_failed'
            : answer
              ? 'completed'
              : 'not_generated',
      };
    });
}

function normalizeSourceIntent(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function normalizeEvaluationResult(value: unknown): ActionArtifact['evaluationResult'] | undefined {
  return value === 'passed' || value === 'safe_fallback' ? value : undefined;
}

function normalizeAcceptTriggerSource(value: unknown): ActionArtifact['acceptTriggerSource'] | undefined {
  return value === 'manual' || value === 'auto_countdown' ? value : undefined;
}

function findUsageForAction(actionId: string, acceptedAt: number, usage: BuildDynamicActionArtifactsInput['usage'][number][]) {
  const direct = usage
    .filter((item) => item.metadata?.source === 'dynamic_action' && item.metadata?.actionId === actionId)
    .sort((left, right) => {
      const priorityDelta = usageGenerationStatusPriority(usageGenerationStatus(right)) - usageGenerationStatusPriority(usageGenerationStatus(left));
      if (priorityDelta !== 0) return priorityDelta;
      return (right.timestamp ?? acceptedAt) - (left.timestamp ?? acceptedAt);
    });
  return direct[0];
}

function normalizeAnswer(answer: unknown): string {
  if (Array.isArray(answer)) return answer.join('\n').trim();
  return typeof answer === 'string' ? answer.trim() : '';
}

function usageGenerationStatus(item: BuildDynamicActionArtifactsInput['usage'][number]): 'accepted' | 'auto_generated' | 'generated_failed' | 'completed' {
  const status = typeof item?.metadata?.generationStatus === 'string' ? item.metadata.generationStatus.trim() : '';
  if (status === 'accepted' || status === 'auto_generated' || status === 'generated_failed' || status === 'completed') {
    return status;
  }
  return normalizeAnswer(item?.answer) ? 'completed' : 'accepted';
}

function usageGenerationStatusPriority(status: ReturnType<typeof usageGenerationStatus>): number {
  switch (status) {
    case 'completed':
      return 4;
    case 'generated_failed':
      return 3;
    case 'auto_generated':
      return 2;
    case 'accepted':
    default:
      return 1;
  }
}

function deriveMissingFields(mode: string, actionType: string, text: string): string[] {
  const missing: string[] = [];
  if (mode === 'team-meet' && ['action_item', 'owner_deadline_check'].includes(actionType)) {
    if (!/\b(owner|Maya|Me)\b|I will|负责人|我来|我负责/i.test(text)) missing.push('owner');
    if (!/(deliverable|task|checklist|proposal|发|send|prepare|review|完成)/i.test(text)) missing.push('deliverable');
    if (!/(due|deadline|by|Friday|Monday|周[一二三四五六日天]|今天|明天|下周)/i.test(text)) missing.push('due_date');
  }
  if (mode === 'fde' && /next|success|risk|agent|integration/.test(actionType)) {
    const marksMissing = (pattern: RegExp) =>
      new RegExp(`(?:缺|缺少|还缺|missing|需要确认|请.*确认).{0,24}${pattern.source}`, 'i').test(text);
    if (!/\bowner\b|负责人|谁负责/i.test(text) || marksMissing(/\bowner\b|负责人|谁负责/)) missing.push('owner');
    if (!/\bdate\b|deadline|by|日期|截止|周[一二三四五六日天]/i.test(text) || marksMissing(/\bdate\b|deadline|日期|截止/)) missing.push('date');
    if (!/(artifact|验证材料|验证产物|交付物|sample|样本)/i.test(text) || marksMissing(/artifact|验证材料|验证产物|交付物|样本/)) missing.push('artifact');
    if (!/(test data|测试数据|真实 ECO|真实 CAPA|样本数据)/i.test(text) || marksMissing(/test data|测试数据|真实 ECO|真实 CAPA|样本数据/)) missing.push('test_data');
    if (!/(acceptance criteria|验收标准|准确率|权限边界|审计可追溯)/i.test(text) || marksMissing(/acceptance criteria|验收标准|准确率|权限边界|审计可追溯/)) missing.push('acceptance_criteria');
  }
  if (mode === 'sales' && actionType === 'buying_signal') {
    if (!/\b(owner|who)\b|负责人/i.test(text)) missing.push('owner');
    if (!/(date|when|by|截止|时间|周[一二三四五六日天])/i.test(text)) missing.push('date');
  }
  return Array.from(new Set(missing));
}

function normalizeGroundedSources(metadata: any, fallbackText: string): ActionArtifact['groundedSources'] {
  if (Array.isArray(metadata?.groundedSources)) {
    return metadata.groundedSources
      .filter((item: any) =>
        ['material', 'pptx', 'screen', 'business_context', 'transcript'].includes(item?.type) &&
        ['used', 'not_found', 'scope_denied', 'failed'].includes(item?.status)
      )
      .map((item: any) => ({
        ...(typeof item.evidenceId === 'string' && item.evidenceId.trim()
          ? { evidenceId: item.evidenceId.trim().slice(0, 80) }
          : {}),
        type: item.type,
        label: typeof item.label === 'string' ? item.label.slice(0, 160) : '',
        status: item.status,
      }));
  }
  return fallbackText ? [{ type: 'transcript', label: 'accepted action', status: 'used' }] : [];
}
