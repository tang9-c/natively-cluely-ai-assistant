export const DYNAMIC_ACTION_UI_STAGES = ['received', 'queued', 'rendered', 'dropped'] as const;
export type DynamicActionUiStage = typeof DYNAMIC_ACTION_UI_STAGES[number];

export const DYNAMIC_ACTION_UI_SURFACES = ['launcher', 'overlay'] as const;
export type DynamicActionUiSurface = typeof DYNAMIC_ACTION_UI_SURFACES[number];

export const DYNAMIC_ACTION_UI_DROP_REASONS = [
  'duplicate',
  'expired',
  'invalid_payload',
  'over_buffer_limit',
  'hidden_window',
] as const;
export type DynamicActionUiDropReason = typeof DYNAMIC_ACTION_UI_DROP_REASONS[number];

export interface DynamicActionUiStageReport {
  actionId: string;
  stage: DynamicActionUiStage;
  surface: DynamicActionUiSurface;
  reason?: DynamicActionUiDropReason;
  ageMs?: number;
  visibleCount?: number;
}

export function sanitizeDynamicActionUiStageReport(value: unknown): DynamicActionUiStageReport | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  if (typeof input.actionId !== 'string' || !input.actionId.trim()) return null;
  if (!DYNAMIC_ACTION_UI_STAGES.includes(input.stage as DynamicActionUiStage)) return null;
  if (!DYNAMIC_ACTION_UI_SURFACES.includes(input.surface as DynamicActionUiSurface)) return null;
  if (input.reason !== undefined
    && !DYNAMIC_ACTION_UI_DROP_REASONS.includes(input.reason as DynamicActionUiDropReason)) return null;

  return {
    actionId: input.actionId.trim().slice(0, 128),
    stage: input.stage as DynamicActionUiStage,
    surface: input.surface as DynamicActionUiSurface,
    ...(input.reason ? { reason: input.reason as DynamicActionUiDropReason } : {}),
    ...(typeof input.ageMs === 'number' && Number.isFinite(input.ageMs)
      ? { ageMs: Math.max(0, Math.round(input.ageMs)) }
      : {}),
    ...(typeof input.visibleCount === 'number' && Number.isFinite(input.visibleCount)
      ? { visibleCount: Math.max(0, Math.round(input.visibleCount)) }
      : {}),
  };
}
