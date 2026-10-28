/** Shared onboarding contracts: no Electron, filesystem or UI dependencies. */
export type OnboardingStep = 'overview' | 'permissions' | 'speech' | 'ai' | 'ready';
export type ValidationTarget = 'stt' | 'ai';
export type CheckStatus = 'missing' | 'checking' | 'verified' | 'previously_verified'
    | 'pending_runtime' | 'limited' | 'failed' | 'unsupported';
export type OnboardingErrorCode = 'permission_denied' | 'device_missing' | 'model_missing'
    | 'model_load_failed' | 'credentials_missing' | 'authentication_failed' | 'model_unavailable'
    | 'network_error' | 'scope_denied' | 'unsupported_check' | 'busy' | 'timeout' | 'stale_config'
    | 'cancelled' | 'storage_failed' | 'initialization_required' | 'schema_unsupported' | 'invalid_request' | 'forbidden';
export interface OnboardingDeviceSelection { inputDeviceId?: string; outputDeviceId?: string }
export interface ValidationReceipt {
    target: ValidationTarget;
    provider: string;
    modelId?: string;
    configRevision: number;
    configIdentity: string;
    checkedAt: number;
    depth: 'model_load' | 'credential_access' | 'model_response';
    result: 'passed' | 'failed';
}
export interface OnboardingProgress {
    version: 1;
    origin: 'fresh' | 'existing';
    lastStep: OnboardingStep;
    deferredAt?: number;
    configurationCompletedAt?: number;
    firstMeetingEnteredAt?: number;
    firstTranscriptReceivedAt?: number;
    meetingHintsDismissed: { transcript: boolean; answer: boolean };
    acceptedSystemAudioLimitation: boolean;
    systemAudioLimitationPlatform?: string;
    configRevision: Record<ValidationTarget, number>;
    validationReceipts: Partial<Record<ValidationTarget, ValidationReceipt>>;
}
export interface OnboardingCheck {
    configured?: boolean;
    status: CheckStatus;
    messageKey?: string;
    errorCode?: OnboardingErrorCode;
    provider?: string;
    modelId?: string;
    configIdentity?: string;
    checkedAt?: number;
    depth?: ValidationReceipt['depth'];
    evidenceSource?: 'system' | 'runtime' | 'validation' | 'history' | 'unavailable';
}
export interface OnboardingSnapshot {
    stateRevision: number;
    progress: OnboardingProgress;
    devices: OnboardingDeviceSelection;
    checks: Record<'microphone' | 'inputDevice' | 'systemAudio' | ValidationTarget, OnboardingCheck>;
    meeting: {
        isActive: boolean;
        isStarting: boolean;
        generation: number;
        phase: 'idle' | 'entering' | 'entered' | 'audio_started' | 'failed';
        hasTranscript: boolean;
        errorCode?: OnboardingErrorCode;
        recoveryStep?: OnboardingStep;
    };
    downloads: { modelId: string; status: 'running' | 'completed' | 'failed'; progress?: number; errorCode?: OnboardingErrorCode }[];
    diagnostics?: { errorCode: OnboardingErrorCode; messageKey: string }[];
}
export type OnboardingProgressAction =
    | { type: 'initialize'; legacySeenStartup: boolean; legacyPermissionsShown: boolean }
    | { type: 'navigate'; step: OnboardingStep }
    | { type: 'defer' }
    | { type: 'acknowledge-system-audio-limitation' }
    | { type: 'dismiss-hint'; hint: 'transcript' | 'answer' };
export type OnboardingStateResult = { success: true; snapshot: OnboardingSnapshot }
    | { success: false; errorCode: OnboardingErrorCode; messageKey: string };
export type ValidationOutcome = { success: true; receipt: ValidationReceipt }
    | { success: false; errorCode: OnboardingErrorCode; messageKey: string };
export type MeetingStartResult = { success: true }
    | { success: false; error?: string; errorCode?: OnboardingErrorCode; recoveryStep?: OnboardingStep };
export interface OnboardingAPI {
    getOnboardingState(selection?: OnboardingDeviceSelection): Promise<OnboardingStateResult>;
    updateOnboardingProgress(action: OnboardingProgressAction): Promise<OnboardingStateResult>;
    validateOnboardingService(input: { target: ValidationTarget; expectedRevision: number }): Promise<ValidationOutcome>;
    onOnboardingStateChanged(callback: (snapshot: OnboardingSnapshot) => void): () => void;
    openOnboarding(input?: { step?: OnboardingStep }): Promise<{ success: boolean }>;
    onOpenOnboarding(callback: (input: { step?: OnboardingStep }) => void): () => void;
}
export type AudioTestResult = { success: true; operationId: string; actualDeviceId: string; usedDefaultFallback: boolean }
    | { success: false; operationId: string; errorCode: OnboardingErrorCode; messageKey: string };
export interface AudioTestState {
    operationId: string;
    status: 'running' | 'stopped' | 'failed';
    errorCode?: OnboardingErrorCode;
}
export interface StartDecision { allowed: boolean; recoveryStep?: OnboardingStep }

export function requiresFirstRunGate(progress: OnboardingProgress): boolean {
    return progress.origin === 'fresh' && progress.configurationCompletedAt === undefined;
}
export function isReceiptCurrent(receipt: ValidationReceipt, revision: number, identity: string): boolean {
    return receipt.result === 'passed' && (receipt.target !== 'ai' || receipt.depth === 'model_response')
        && receipt.configRevision === revision
        && identity.length > 0 && receipt.configIdentity === identity;
}
export function derivePreparationDecision(snapshot: OnboardingSnapshot): StartDecision {
    const { checks, progress } = snapshot;
    const verified = (check: OnboardingCheck) => check.status === 'verified' || check.status === 'previously_verified';
    const permission = (check: OnboardingCheck) => verified(check) || check.status === 'pending_runtime';
    if (!permission(checks.microphone) || !verified(checks.inputDevice)
        || !(permission(checks.systemAudio) || (progress.acceptedSystemAudioLimitation
            && (checks.systemAudio.status === 'limited' || checks.systemAudio.errorCode === 'permission_denied')))) {
        return { allowed: false, recoveryStep: 'permissions' };
    }
    for (const target of ['stt', 'ai'] as const) {
        const check = checks[target];
        const receipt = progress.validationReceipts[target];
        if (!verified(check) || check.errorCode || !receipt || receipt.target !== target
            || !isReceiptCurrent(receipt, progress.configRevision[target], check.configIdentity ?? '')
            || (target === 'stt' && check.provider?.startsWith('local-') && receipt.depth !== 'model_load')
            || (target === 'stt' && snapshot.downloads.some(download => download.modelId === check.modelId && download.status === 'running'))) {
            return { allowed: false, recoveryStep: target === 'stt' ? 'speech' : 'ai' };
        }
    }
    return { allowed: true };
}
export function deriveFirstRunStartDecision(snapshot: OnboardingSnapshot): StartDecision {
    if (snapshot.meeting.isActive || snapshot.meeting.isStarting || !requiresFirstRunGate(snapshot.progress)) return { allowed: true };
    return derivePreparationDecision(snapshot);
}

export type OnboardingMeetingEvent = { generation: number; synthetic: boolean } & (
    | { kind: 'entered' | 'audio-started' | 'ended' }
    | { kind: 'transcript'; hasNonEmptyText: boolean }
    | { kind: 'failed'; errorCode: OnboardingErrorCode; recoveryStep?: OnboardingStep }
);
