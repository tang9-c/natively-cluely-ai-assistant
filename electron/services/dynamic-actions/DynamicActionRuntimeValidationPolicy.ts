import {
  buildCapabilityFitSafeFallback,
  buildFdeGroundedAnswerSafeFallback,
  buildRecruitingEvidenceSafeFallback,
  buildRecruitingPolicySafeFallback,
} from './DynamicActionAcceptedOutputEvaluator';

export type DynamicActionRuntimeEvidenceKind =
  | 'external_capability'
  | 'external_policy'
  | 'transcript_evidence';

export interface DynamicActionRuntimeValidationPolicy {
  actionType: string;
  evidenceKind: DynamicActionRuntimeEvidenceKind;
  claimDomain?: 'capability' | 'recruiting_policy';
}

const POLICIES: Record<string, DynamicActionRuntimeValidationPolicy> = {
  case_study_request: { actionType: 'case_study_request', evidenceKind: 'external_capability', claimDomain: 'capability' },
  capability_fit_answer: { actionType: 'capability_fit_answer', evidenceKind: 'external_capability', claimDomain: 'capability' },
  fde_grounded_answer: { actionType: 'fde_grounded_answer', evidenceKind: 'external_capability', claimDomain: 'capability' },
  candidate_concern: { actionType: 'candidate_concern', evidenceKind: 'external_policy', claimDomain: 'recruiting_policy' },
  candidate_evidence_summary: { actionType: 'candidate_evidence_summary', evidenceKind: 'transcript_evidence' },
};

export function getDynamicActionRuntimeValidationPolicy(
  actionType: string | undefined,
): DynamicActionRuntimeValidationPolicy | null {
  return actionType ? POLICIES[actionType] ?? null : null;
}

export function buildDynamicActionRuntimeSafeFallback(
  actionType: string,
  language?: string,
): string | null {
  const policy = getDynamicActionRuntimeValidationPolicy(actionType);
  if (policy?.actionType === 'case_study_request') {
    return language === 'zh'
      ? '已上传资料中没有找到可引用的匹配案例，先不编造客户名称、收益或 ROI；建议会后补充案例材料后再回复。'
      : 'I could not find a matching case study in the uploaded materials, so I will not invent customer names, outcomes, or ROI. I should follow up after adding the right case material.';
  }
  if (policy?.actionType === 'capability_fit_answer') {
    return buildCapabilityFitSafeFallback(language);
  }
  if (policy?.actionType === 'fde_grounded_answer') {
    return buildFdeGroundedAnswerSafeFallback(language);
  }
  if (policy?.evidenceKind === 'external_policy') {
    return buildRecruitingPolicySafeFallback(language);
  }
  if (policy?.evidenceKind === 'transcript_evidence') {
    return buildRecruitingEvidenceSafeFallback(language);
  }
  return null;
}
