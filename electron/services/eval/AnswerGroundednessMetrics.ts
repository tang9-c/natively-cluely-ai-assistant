export interface OfflineAnswerEvalResult {
    citationRecall: number;
    groundedness: number;
    refusalAccuracy: number;
    scopeLeakCount: number;
    staleCitationOpenedCount: number;
    p1UiMismatchCount: number;
}

export interface RollbackGateResult {
    passed: boolean;
    failedReasons: string[];
}

export function computeCitationRecall(requiredCitationIds: string[], actualCitationIds: string[]): number {
    if (requiredCitationIds.length === 0) return 1;
    const actual = new Set(actualCitationIds);
    const recalled = requiredCitationIds.filter((id) => actual.has(id)).length;
    return recalled / requiredCitationIds.length;
}

export function computeGroundednessScore(claims: Array<{ supported: boolean }>): number {
    if (claims.length === 0) return 1;
    return claims.filter((claim) => claim.supported).length / claims.length;
}

export function computeRefusalAccuracy(cases: Array<{ unsupported: boolean; refused: boolean }>): number {
    const unsupported = cases.filter((item) => item.unsupported);
    if (unsupported.length === 0) return 1;
    return unsupported.filter((item) => item.refused).length / unsupported.length;
}

export function evaluateRollbackGates(input: OfflineAnswerEvalResult): RollbackGateResult {
    const failedReasons: string[] = [];
    if (input.scopeLeakCount > 0) failedReasons.push('scope_leak_detected');
    if (input.staleCitationOpenedCount > 0) failedReasons.push('stale_citation_opened');
    if (input.citationRecall < 0.8) failedReasons.push('citation_recall_below_threshold');
    if (input.refusalAccuracy < 0.9) failedReasons.push('refusal_accuracy_below_threshold');
    if (input.p1UiMismatchCount > 1) failedReasons.push('too_many_p1_ui_mismatches');
    return {
        passed: failedReasons.length === 0,
        failedReasons,
    };
}
