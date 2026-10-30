import { derivePreparationDecision, isReceiptCurrent } from '../../../shared/onboarding';
import type { OnboardingDeviceSelection, OnboardingErrorCode, OnboardingMeetingEvent, OnboardingProgress, OnboardingProgressAction,
    OnboardingSnapshot, OnboardingStep, ValidationReceipt, ValidationTarget } from '../../../shared/onboarding';

export class OnboardingError extends Error {
    readonly messageKey: string;
    constructor(readonly code: OnboardingErrorCode) {
        super(code);
        this.messageKey = `onboarding.${code}`;
    }
}
export interface OnboardingDependencies {
    load(): unknown;
    save(progress: OnboardingProgress): void;
    readLegacyEvidence(): { hasNonDemoMeeting: boolean; hasSavedServiceConfiguration: boolean };
    readChecks(selection?: OnboardingDeviceSelection): Promise<OnboardingSnapshot['checks']>;
    readConfiguration?(target: ValidationTarget): Partial<OnboardingSnapshot['checks']['stt']>;
    now(): number;
    platform(): string;
}
const steps: OnboardingStep[] = ['overview', 'permissions', 'speech', 'ai', 'ready'];
function validLegacy(value: unknown): value is { legacySeenStartup: boolean; legacyPermissionsShown: boolean } {
    const input = value as Record<string, unknown> | null;
    return !!input && typeof input.legacySeenStartup === 'boolean' && typeof input.legacyPermissionsShown === 'boolean';
}
function assertAction(value: unknown): asserts value is OnboardingProgressAction {
    const action = value as Record<string, unknown> | null;
    const fields: Record<string, string[]> = { initialize: ['legacySeenStartup', 'legacyPermissionsShown'],
        navigate: ['step'], defer: [], 'acknowledge-system-audio-limitation': [], 'dismiss-hint': ['hint'] };
    if (!action || typeof action.type !== 'string' || !Object.hasOwn(fields, action.type)
        || Object.keys(action).some(key => key !== 'type' && !fields[action.type as string].includes(key))
        || (action.type === 'initialize' && !validLegacy(action))
        || (action.type === 'navigate' && !steps.includes(action.step as OnboardingStep))
        || (action.type === 'dismiss-hint' && action.hint !== 'transcript' && action.hint !== 'answer')) {
        throw new OnboardingError('invalid_request');
    }
}
function readProgress(value: unknown): OnboardingProgress {
    const p = value as OnboardingProgress;
    if (!p || p.version !== 1) throw new OnboardingError('schema_unsupported');
    if (!['fresh', 'existing'].includes(p.origin) || !steps.includes(p.lastStep)
        || !p.meetingHintsDismissed || typeof p.meetingHintsDismissed.transcript !== 'boolean'
        || typeof p.meetingHintsDismissed.answer !== 'boolean' || typeof p.acceptedSystemAudioLimitation !== 'boolean'
        || !p.configRevision || !['stt', 'ai'].every(key => Number.isSafeInteger(p.configRevision[key as ValidationTarget])
            && p.configRevision[key as ValidationTarget] >= 0) || !p.validationReceipts) throw new OnboardingError('storage_failed');
    // Whitelist persisted progress: renderer/private data cannot become onboarding storage.
    const result: OnboardingProgress = { version: 1, origin: p.origin, lastStep: p.lastStep,
        meetingHintsDismissed: { transcript: p.meetingHintsDismissed.transcript, answer: p.meetingHintsDismissed.answer },
        acceptedSystemAudioLimitation: p.acceptedSystemAudioLimitation,
        configRevision: { stt: p.configRevision.stt, ai: p.configRevision.ai }, validationReceipts: {} };
    for (const key of ['deferredAt', 'configurationCompletedAt', 'firstMeetingEnteredAt', 'firstTranscriptReceivedAt'] as const) {
        if (p[key] !== undefined) {
            if (!Number.isFinite(p[key]) || p[key]! < 0) throw new OnboardingError('storage_failed');
            result[key] = p[key];
        }
    }
    if (typeof p.systemAudioLimitationPlatform === 'string') result.systemAudioLimitationPlatform = p.systemAudioLimitationPlatform;
    for (const target of ['stt', 'ai'] as const) {
        const r = p.validationReceipts[target];
        if (!r) continue;
        if (r.target !== target || typeof r.provider !== 'string' || typeof r.configIdentity !== 'string'
            || !Number.isSafeInteger(r.configRevision) || r.configRevision < 0 || !Number.isFinite(r.checkedAt)
            || !['model_load', 'credential_access', 'model_response'].includes(r.depth)
            || !['passed', 'failed'].includes(r.result) || (r.modelId !== undefined && typeof r.modelId !== 'string')) {
            throw new OnboardingError('storage_failed');
        }
        result.validationReceipts[target] = { target, provider: r.provider, configIdentity: r.configIdentity,
            configRevision: r.configRevision, checkedAt: r.checkedAt, depth: r.depth, result: r.result,
            ...(r.modelId === undefined ? {} : { modelId: r.modelId }) };
    }
    return result;
}
export class OnboardingService {
    private snapshot?: OnboardingSnapshot;
    private initializationError?: OnboardingErrorCode;
    private listeners = new Set<(snapshot: OnboardingSnapshot) => void>();
    private refreshGeneration = 0;
    private actionQueue: Promise<unknown> = Promise.resolve();
    private invalidated = new Set<ValidationTarget>();
    private sessionReceipts = new Set<ValidationTarget>();
    private audioAcknowledgementRevoked = false;
    private downloads = new Map<string, OnboardingSnapshot['downloads'][number]>();
    private validationStates = new Map<ValidationTarget, { revision: number; identity: string; status: OnboardingSnapshot['checks']['stt']['status']; errorCode?: OnboardingErrorCode }>();

    constructor(private readonly deps: OnboardingDependencies) {}

    initialize(legacy: { legacySeenStartup: boolean; legacyPermissionsShown: boolean }): OnboardingSnapshot {
        if (!validLegacy(legacy)) throw new OnboardingError('invalid_request');
        if (this.snapshot) return this.getSnapshot();
        let stored: unknown;
        try { stored = this.deps.load(); } catch { throw new OnboardingError('storage_failed'); }
        let diagnostic = false;
        let progress: OnboardingProgress;
        if (stored !== undefined && stored !== null) {
            try { progress = readProgress(stored); }
            catch (error) { this.initializationError = (error as OnboardingError).code; throw error; }
        }
        else {
            let existing = legacy.legacySeenStartup || legacy.legacyPermissionsShown;
            try {
                const evidence = this.deps.readLegacyEvidence();
                existing ||= evidence.hasNonDemoMeeting || evidence.hasSavedServiceConfiguration;
            } catch { existing = true; diagnostic = true; }
            progress = { version: 1, origin: existing ? 'existing' : 'fresh', lastStep: 'overview',
                meetingHintsDismissed: { transcript: false, answer: false }, acceptedSystemAudioLimitation: false,
                configRevision: { stt: 0, ai: 0 }, validationReceipts: {} };
        }
        const changedPlatform = progress.acceptedSystemAudioLimitation
            && progress.systemAudioLimitationPlatform !== this.deps.platform();
        if (changedPlatform) {
            progress.acceptedSystemAudioLimitation = false;
            delete progress.systemAudioLimitationPlatform;
        }
        if (stored == null || changedPlatform) {
            try { this.deps.save(structuredClone(progress)); } catch { throw new OnboardingError('storage_failed'); }
        }
        this.snapshot = { stateRevision: 1, progress, devices: {},
            checks: { microphone: { status: 'missing' }, inputDevice: { status: 'missing' }, systemAudio: { status: 'missing' },
                stt: { status: 'missing' }, ai: { status: 'missing' } },
            meeting: { isActive: false, isStarting: false, generation: 0, phase: 'idle', hasTranscript: false }, downloads: [...this.downloads.values()],
            ...(diagnostic ? { diagnostics: [{ errorCode: 'storage_failed' as const, messageKey: 'onboarding.legacy_evidence_unavailable' }] } : {}) };
        this.publish();
        return this.getSnapshot();
    }

    getSnapshot(): OnboardingSnapshot {
        if (!this.snapshot) throw new OnboardingError(this.initializationError ?? 'initialization_required');
        const result = structuredClone(this.snapshot);
        if (this.audioAcknowledgementRevoked) {
            result.progress.acceptedSystemAudioLimitation = false;
            delete result.progress.systemAudioLimitationPlatform;
        }
        for (const target of ['stt', 'ai'] as const) {
            const check = result.checks[target];
            let configError: OnboardingErrorCode | undefined;
            if (this.deps.readConfiguration) {
                const config = this.deps.readConfiguration(target);
                if (check.messageKey === 'onboarding.language_unsupported' && check.configIdentity !== config.configIdentity) {
                    delete check.messageKey;
                    delete check.errorCode;
                    check.status = 'missing';
                }
                Object.assign(check, { configIdentity: config.configIdentity, provider: config.provider, modelId: config.modelId,
                    configured: config.configured, modelName: config.modelName, qcloudKeyConfigured: config.qcloudKeyConfigured, languageKey: config.languageKey });
                configError = config.errorCode;
                if (check.errorCode === 'credentials_missing' || check.errorCode === 'scope_denied') delete check.errorCode;
                if (config.errorCode) { check.errorCode = config.errorCode; check.status = 'missing'; }
            }
            const validation = this.validationStates.get(target);
            if (validation?.revision === result.progress.configRevision[target] && validation.identity === check.configIdentity) {
                check.status = validation.status;
                if (validation.status === 'verified' && !configError) delete check.errorCode;
                if (validation.errorCode === 'unsupported_check' && check.errorCode !== 'scope_denied') check.errorCode = validation.errorCode;
                else check.errorCode ??= validation.errorCode;
            }
            const receipt = result.progress.validationReceipts[target];
            if (this.invalidated.has(target)) {
                check.status = 'failed'; check.errorCode = 'storage_failed';
            } else if (check.status !== 'checking' && !check.errorCode && receipt
                && isReceiptCurrent(receipt, result.progress.configRevision[target], check.configIdentity ?? '')
                && !['failed', 'unsupported'].includes(check.status)) {
                check.status = this.sessionReceipts.has(target) ? 'verified' : 'previously_verified';
                check.checkedAt = receipt.checkedAt; check.depth = receipt.depth;
                check.evidenceSource = this.sessionReceipts.has(target) ? 'validation' : 'history';
            } else if (check.status === 'verified' || check.status === 'previously_verified') {
                check.status = 'missing';
            }
        }
        return result;
    }

    setCheckReader(reader: OnboardingDependencies['readChecks']): void { this.deps.readChecks = reader; }

    beginMeeting(generation: number): void {
        if (!this.snapshot) return;
        this.snapshot.meeting = { isActive: false, isStarting: true, generation, phase: 'entering', hasTranscript: false };
        this.changed();
    }

    recordMeetingEvent(event: OnboardingMeetingEvent): void {
        if (!this.snapshot) return;
        const meeting = this.snapshot.meeting;
        if (!Number.isSafeInteger(event.generation) || event.generation < meeting.generation) return;
        if (event.kind === 'entered' && event.generation > meeting.generation) {
            this.snapshot.meeting = { isActive: true, isStarting: false, generation: event.generation, phase: 'entered', hasTranscript: false };
        } else if (event.generation !== meeting.generation) return;
        const current = this.snapshot.meeting;
        if (event.kind === 'entered' && current.phase === 'idle') return;
        const progress = structuredClone(this.snapshot.progress);
        if (event.kind === 'entered') {
            if (current.phase === 'failed') return;
            Object.assign(current, { isActive: true, isStarting: false, phase: 'entered' });
            if (!event.synthetic && progress.firstMeetingEnteredAt === undefined) progress.firstMeetingEnteredAt = this.deps.now();
        } else if (event.kind === 'failed') {
            Object.assign(current, { isActive: false, isStarting: false, phase: 'failed', errorCode: event.errorCode, recoveryStep: event.recoveryStep });
        } else if (event.kind === 'ended') {
            this.snapshot.meeting = { isActive: false, isStarting: false, generation: event.generation, phase: 'idle', hasTranscript: false };
        } else if (!current.isActive || current.phase === 'failed') return;
        else if (event.kind === 'audio-started') current.phase = 'audio_started';
        else if (event.kind === 'transcript' && event.hasNonEmptyText) {
            current.hasTranscript = true;
            if (!event.synthetic && progress.firstTranscriptReceivedAt === undefined) progress.firstTranscriptReceivedAt = this.deps.now();
        }
        if (JSON.stringify(progress) !== JSON.stringify(this.snapshot.progress)) this.commit(progress);
        else this.changed();
    }

    async refreshChecks(selection?: OnboardingDeviceSelection): Promise<OnboardingSnapshot> {
        this.getSnapshot();
        if (selection && (Object.keys(selection).some(key => !['inputDeviceId', 'outputDeviceId'].includes(key))
            || Object.values(selection).some(id => id !== undefined && (typeof id !== 'string' || id.length > 1024)))) {
            throw new OnboardingError('invalid_request');
        }
        const generation = ++this.refreshGeneration;
        const devices = selection === undefined ? this.snapshot!.devices : structuredClone(selection);
        const checks = await this.deps.readChecks(devices);
        if (generation !== this.refreshGeneration) return this.getSnapshot();
        this.snapshot!.devices = structuredClone(devices);
        this.snapshot!.checks = structuredClone(checks);
        if (checks.systemAudio.status === 'verified' || checks.systemAudio.status === 'previously_verified'
            || (checks.systemAudio.status === 'pending_runtime' && checks.systemAudio.evidenceSource === 'system' && !checks.systemAudio.errorCode)) {
            this.audioAcknowledgementRevoked = true;
        }
        this.changed();
        return this.getSnapshot();
    }

    applyAction(action: OnboardingProgressAction): Promise<OnboardingSnapshot> {
        const operation = this.actionQueue.then(async () => {
            assertAction(action);
            if (action.type === 'initialize') return this.initialize(action);
            this.getSnapshot();
            if ((action.type === 'navigate' && action.step === 'ready') || action.type === 'defer'
                || action.type === 'acknowledge-system-audio-limitation') await this.refreshChecks();
            const next = this.getSnapshot().progress;
            switch (action.type) {
                case 'navigate': next.lastStep = action.step; break;
                case 'defer': next.deferredAt = this.deps.now(); break;
                case 'dismiss-hint': next.meetingHintsDismissed[action.hint] = true; break;
                case 'acknowledge-system-audio-limitation': {
                    const check = this.snapshot!.checks.systemAudio;
                    if (check.status !== 'limited' && check.errorCode !== 'permission_denied') throw new OnboardingError('invalid_request');
                    next.acceptedSystemAudioLimitation = true;
                    next.systemAudioLimitationPlatform = this.deps.platform();
                    break;
                }
            }
            if (((action.type === 'navigate' && action.step === 'ready') || action.type === 'defer')
                && next.configurationCompletedAt === undefined && derivePreparationDecision(this.getSnapshot()).allowed) {
                next.configurationCompletedAt = this.deps.now();
            }
            this.commit(next);
            if (action.type === 'acknowledge-system-audio-limitation') {
                this.audioAcknowledgementRevoked = false;
                this.changed();
            }
            return this.getSnapshot();
        });
        this.actionQueue = operation.catch(() => {});
        return operation;
    }

    subscribe(callback: (snapshot: OnboardingSnapshot) => void): () => void {
        this.listeners.add(callback);
        return () => { this.listeners.delete(callback); };
    }

    hasActiveDownloads(): boolean { return [...this.downloads.values()].some(download => download.status === 'running'); }

    isDownloadActive(modelId: string): boolean { return this.downloads.get(modelId)?.status === 'running'; }

    updateDownload(download: OnboardingSnapshot['downloads'][number]): void {
        this.downloads.set(download.modelId, { modelId: download.modelId, status: download.status,
            ...(download.progress === undefined ? {} : { progress: download.progress }),
            ...(download.errorCode ? { errorCode: download.errorCode } : {}) });
        if (this.snapshot) { this.snapshot.downloads = [...this.downloads.values()]; this.changed(); }
    }

    setValidationStatus(target: ValidationTarget, revision: number, identity: string,
        status: OnboardingSnapshot['checks']['stt']['status'], errorCode?: OnboardingErrorCode): void {
        this.validationStates.set(target, { revision, identity, status, errorCode });
        if (this.snapshot) this.changed();
    }

    invalidate(target: ValidationTarget): void {
        if (!this.snapshot) return; // Configuration before initialization has no trusted receipts.
        const next = structuredClone(this.snapshot.progress);
        next.configRevision[target]++;
        this.sessionReceipts.delete(target);
        this.commit(next, target);
    }

    recordValidation(receipt: ValidationReceipt): OnboardingSnapshot {
        const current = this.getSnapshot();
        const target = receipt.target;
        if (!['stt', 'ai'].includes(target) || receipt.configRevision !== current.progress.configRevision[target]
            || !receipt.configIdentity || receipt.configIdentity !== current.checks[target].configIdentity) throw new OnboardingError('stale_config');
        const next = current.progress;
        next.validationReceipts[target] = receipt;
        const progress = readProgress(next);
        const previouslyVerified = this.sessionReceipts.has(target);
        if (receipt.result === 'passed') this.sessionReceipts.add(target);
        else this.sessionReceipts.delete(target);
        try { this.commit(progress, target); }
        catch (error) {
            if (previouslyVerified) this.sessionReceipts.add(target);
            else this.sessionReceipts.delete(target);
            throw error;
        }
        return this.getSnapshot();
    }

    private commit(progress: OnboardingProgress, target?: ValidationTarget): void {
        try { this.deps.save(structuredClone(progress)); }
        catch {
            if (target) this.invalidated.add(target);
            this.snapshot!.diagnostics = [{ errorCode: 'storage_failed', messageKey: 'onboarding.storage_failed' }];
            this.changed();
            throw new OnboardingError('storage_failed');
        }
        this.snapshot!.progress = structuredClone(progress);
        const diagnostics = this.snapshot!.diagnostics?.filter(item => item.messageKey !== 'onboarding.storage_failed');
        if (diagnostics?.length) this.snapshot!.diagnostics = diagnostics;
        else delete this.snapshot!.diagnostics;
        if (target) this.invalidated.delete(target);
        this.changed();
    }
    private changed(): void { this.snapshot!.stateRevision++; this.publish(); }
    private publish(): void {
        for (const callback of this.listeners) {
            // A detached renderer/listener must not turn a committed write into a failure.
            try { callback(this.getSnapshot()); } catch { /* state remains available to the next read */ }
        }
    }
}
