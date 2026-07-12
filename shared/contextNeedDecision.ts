export type ContextNeedLevel = 'required' | 'use_if_ready' | 'not_needed' | 'unknown';

export type ContextNeedDecisionSource =
  | 'llm_semantic_gate'
  | 'dynamic_action_contract'
  | 'cached_speculative'
  | 'unknown';

export interface ContextNeedDecision {
  material: ContextNeedLevel;
  business: ContextNeedLevel;
  screen: ContextNeedLevel;
  confidence: number;
  reason: string;
  decidedBy: ContextNeedDecisionSource;
}
