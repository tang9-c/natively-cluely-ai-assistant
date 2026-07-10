import type {
  DynamicActionOutputType,
  DynamicActionRiskState,
} from './DynamicAction';

export type DynamicActionLifecycleEventName =
  | 'shown'
  | 'accepted'
  | 'auto_generated'
  | 'dismissed'
  | 'expired'
  | 'generated_failed'
  | 'completed';

export type DynamicActionAcceptTriggerSourceForLifecycle = 'manual' | 'auto_countdown';

export type DynamicActionGenerationStatusForLifecycle =
  | 'completed'
  | 'generated_failed'
  | 'not_generated';

export interface DynamicActionLifecycleEvent {
  event: DynamicActionLifecycleEventName;
  actionId?: string;
  actionType: string;
  modeId?: string;
  modeTemplateType: string;
  outputType: DynamicActionOutputType;
  riskState: DynamicActionRiskState;
  triggerSource?: DynamicActionAcceptTriggerSourceForLifecycle;
  generationStatus?: DynamicActionGenerationStatusForLifecycle;
  status?: string;
}

export function lifecycleEventToTelemetryName(event: DynamicActionLifecycleEventName): string {
  switch (event) {
    case 'shown':
      return 'dynamic_action_shown';
    case 'accepted':
      return 'dynamic_action_accepted';
    case 'auto_generated':
      return 'dynamic_action_auto_generated';
    case 'dismissed':
      return 'dynamic_action_dismissed';
    case 'expired':
      return 'dynamic_action_expired';
    case 'generated_failed':
      return 'dynamic_action_generation_failed';
    case 'completed':
      return 'dynamic_action_completed';
  }
}
