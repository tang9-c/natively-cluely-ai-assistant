import type { DynamicActionOutputType } from './DynamicAction';

export interface ActionArtifact {
  actionId: string;
  modeTemplateType: 'sales' | 'fde' | 'team-meet';
  actionType: string;
  outputType: DynamicActionOutputType;
  structuredSummary: string;
  missingFields: string[];
  groundedSources: Array<{
    type: 'material' | 'pptx' | 'screen' | 'business_context' | 'transcript';
    label: string;
    status: 'used' | 'not_found' | 'scope_denied' | 'failed';
  }>;
  acceptedAt: number;
  acceptTriggerSource?: 'manual' | 'auto_countdown';
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

const ARTIFACT_MODES = new Set(['sales', 'fde', 'team-meet']);

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
      return {
        actionId: action.id,
        modeTemplateType: action.modeTemplateType as ActionArtifact['modeTemplateType'],
        actionType: action.type,
        outputType: action.productContract.outputType,
        structuredSummary,
        missingFields: deriveMissingFields(action.modeTemplateType, action.type, structuredSummary),
        groundedSources: normalizeGroundedSources(usage?.metadata, structuredSummary),
        acceptedAt: action.createdAt,
        ...(acceptTriggerSource ? { acceptTriggerSource } : {}),
        generationStatus:
          action.status === 'generated_failed'
            ? 'generated_failed'
            : answer
              ? 'completed'
              : 'not_generated',
      };
    });
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
    if (!/\bowner\b|负责人/i.test(text)) missing.push('owner');
    if (!/(artifact|验证材料|交付物|测试数据|sample|样本)/i.test(text)) missing.push('artifact');
  }
  if (mode === 'sales' && actionType === 'buying_signal') {
    if (!/\b(owner|who)\b|负责人/i.test(text)) missing.push('owner');
    if (!/(date|when|by|截止|时间|周[一二三四五六日天])/i.test(text)) missing.push('date');
  }
  return Array.from(new Set(missing));
}

function normalizeGroundedSources(metadata: any, fallbackText: string): ActionArtifact['groundedSources'] {
  if (Array.isArray(metadata?.groundedSources)) {
    return metadata.groundedSources.filter((item: any) =>
      ['material', 'pptx', 'screen', 'business_context', 'transcript'].includes(item?.type) &&
      ['used', 'not_found', 'scope_denied', 'failed'].includes(item?.status)
    );
  }
  return fallbackText ? [{ type: 'transcript', label: 'accepted action', status: 'used' }] : [];
}
