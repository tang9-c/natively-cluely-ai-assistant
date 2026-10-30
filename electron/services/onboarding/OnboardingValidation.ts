import { QCLOUD_CHAT_COMPLETIONS_ENDPOINT, QCLOUD_CHAT_MODEL } from '../../llm/QCloudLlmConstants';
import type { OnboardingCheck, OnboardingErrorCode, ValidationOutcome, ValidationReceipt, ValidationTarget } from '../../../shared/onboarding';
import { OnboardingError, OnboardingService } from './OnboardingService';
import type { LocalSttWorkerLease } from '../../audio/LocalSttWorkerPool';

export interface ValidationEvidence { provider: string; modelId?: string; depth: ValidationReceipt['depth'] }
interface ValidationDependencies {
    service: OnboardingService;
    isBusy(): boolean;
    prepare?(target: ValidationTarget): void;
    execute(target: ValidationTarget, check: OnboardingCheck, signal: AbortSignal): Promise<ValidationEvidence>;
    now?: () => number;
    setTimeout?: (callback: () => void, delay: number) => any;
    clearTimeout?: (handle: any) => void;
}
const failure = (errorCode: OnboardingErrorCode): ValidationOutcome => ({ success: false, errorCode, messageKey: `onboarding.${errorCode}` });
export function validationErrorCode(error: unknown): OnboardingErrorCode {
    if (error instanceof OnboardingError) return error.code;
    const e = error as { code?: string; response?: { status?: number }; status?: number };
    const allowed: OnboardingErrorCode[] = ['permission_denied', 'device_missing', 'model_missing', 'model_load_failed', 'credentials_missing',
        'authentication_failed', 'model_unavailable', 'network_error', 'scope_denied', 'unsupported_check', 'busy', 'timeout', 'stale_config', 'storage_failed', 'initialization_required', 'schema_unsupported', 'invalid_request', 'forbidden', 'cancelled'];
    if (allowed.includes(e?.code as OnboardingErrorCode)) return e.code as OnboardingErrorCode;
    if (e?.code === 'ECONNABORTED' || e?.code === 'ETIMEDOUT') return 'timeout';
    const status = e?.response?.status ?? e?.status;
    if (status === 401 || status === 403) return 'authentication_failed';
    if (status === 402 || status === 404 || status === 429) return 'model_unavailable';
    return 'network_error';
}
export class OnboardingValidation {
    private tasks = new Map<ValidationTarget, { revision: number; identity: string; promise: Promise<ValidationOutcome>; expired: boolean }>();
    constructor(private readonly deps: ValidationDependencies) {}
    isBusy(target?: ValidationTarget): boolean { return target ? this.tasks.has(target) : this.tasks.size > 0; }

    validate(target: ValidationTarget, expectedRevision: number): Promise<ValidationOutcome> {
        if (!['stt', 'ai'].includes(target) || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) return Promise.resolve(failure('invalid_request'));
        try {
            if (this.deps.isBusy()) return Promise.resolve(failure('busy'));
            let snapshot = this.deps.service.getSnapshot();
            const previous = this.tasks.get(target);
            if (previous) {
                if (!previous.expired && previous.revision === expectedRevision
                    && previous.identity === snapshot.checks[target].configIdentity) return previous.promise;
                return Promise.resolve(failure('busy'));
            }
            if (snapshot.progress.configRevision[target] !== expectedRevision) return Promise.resolve(failure('stale_config'));
            try { this.deps.prepare?.(target); } catch { return Promise.resolve(failure('storage_failed')); }
            snapshot = this.deps.service.getSnapshot();
            const check = snapshot.checks[target];
            if (target === 'stt' && snapshot.downloads.some(d => d.modelId === check.modelId && d.status === 'running')) return Promise.resolve(failure('busy'));
            if (check.errorCode === 'scope_denied') return Promise.resolve(failure('scope_denied'));
            if (!check.configIdentity || !check.provider) return Promise.resolve(failure('credentials_missing'));
            const revision = snapshot.progress.configRevision[target], identity = check.configIdentity;
            const controller = new AbortController();
            let resolve!: (result: ValidationOutcome) => void;
            const promise = new Promise<ValidationOutcome>(r => { resolve = r; });
            const task = { revision, identity, promise, expired: false };
            this.tasks.set(target, task);
            this.deps.service.setValidationStatus(target, revision, identity, 'checking');
            const current = () => {
                const s = this.deps.service.getSnapshot();
                return s.progress.configRevision[target] === revision && s.checks[target].configIdentity === identity;
            };
            const settle = (code?: OnboardingErrorCode, evidence?: ValidationEvidence): ValidationOutcome => {
                if (!current()) return failure('stale_config');
                if (this.deps.isBusy()) code = 'busy';
                const receipt: ValidationReceipt = { target, provider: check.provider!, modelId: check.modelId,
                    configRevision: revision, configIdentity: identity, checkedAt: (this.deps.now ?? Date.now)(),
                    depth: evidence?.depth ?? (target === 'ai' ? 'model_response' : check.provider!.startsWith('local-') ? 'model_load' : 'credential_access'),
                    result: code ? 'failed' : 'passed' };
                try {
                    this.deps.service.recordValidation(receipt);
                    this.deps.service.setValidationStatus(target, revision, identity,
                        code === 'unsupported_check' ? 'unsupported' : code ? 'failed' : 'verified', code);
                    return code ? failure(code) : { success: true, receipt };
                } catch (error) { return failure(validationErrorCode(error)); }
            };
            const timer = (this.deps.setTimeout ?? setTimeout)(() => {
                task.expired = true;
                controller.abort();
                resolve(settle('timeout'));
            }, 60_000);
            void Promise.resolve().then(() => this.deps.execute(target, check, controller.signal)).then(evidence => {
                if (task.expired) return;
                const mismatch = evidence.provider !== check.provider || evidence.modelId !== check.modelId
                    || (target === 'ai' && evidence.depth !== 'model_response')
                    || (target === 'stt' && check.provider!.startsWith('local-') && evidence.depth !== 'model_load');
                resolve(settle(mismatch ? 'model_unavailable' : undefined, evidence));
            }, error => {
                if (!task.expired) resolve(settle(validationErrorCode(error)));
            }).finally(() => {
                (this.deps.clearTimeout ?? clearTimeout)(timer);
                if (this.tasks.get(target) === task) this.tasks.delete(target);
            });
            return promise;
        } catch (error) { return Promise.resolve(failure(validationErrorCode(error))); }
    }
}
export function createSpeechExecutor(deps: {
    isCached(provider: string, modelId: string): boolean;
    modelIds?(provider: string, modelId: string): string[];
    acquireLease(provider: string, modelId: string): LocalSttWorkerLease;
    testSavedConnection(provider: string, signal: AbortSignal): Promise<{ success: boolean; errorCode?: OnboardingErrorCode }>;
}): (check: OnboardingCheck, signal: AbortSignal) => Promise<ValidationEvidence> {
    return async (check, signal) => {
        const provider = check.provider!, modelId = check.modelId!;
        if (provider === 'local-sensevoice' || provider === 'local-whisper') {
            const models = [...new Set(deps.modelIds?.(provider, modelId) ?? [modelId])];
            if (models.some(model => !deps.isCached(provider, model))) throw new OnboardingError('model_missing');
            for (const model of models) {
                if (signal.aborted) throw new OnboardingError('timeout');
                const lease = deps.acquireLease(provider, model);
                try { await lease.waitUntilReady(signal); }
                catch (error) { throw new OnboardingError(signal.aborted ? 'timeout' : 'model_load_failed'); }
                finally { await lease.release(); }
            }
            return { provider, modelId, depth: 'model_load' };
        }
        // Detectors with heuristic success (e.g. silent Soniox/ElevenLabs) cannot certify onboarding.
        if (!['doubao-auc', 'qcloud-stt', 'openai', 'groq', 'azure', 'ibmwatson'].includes(provider)) throw new OnboardingError('unsupported_check');
        const result = await deps.testSavedConnection(provider, signal);
        if (!result.success) throw new OnboardingError(result.errorCode ?? 'network_error');
        return { provider, modelId, depth: 'credential_access' };
    };
}

export interface SavedAiValidationConfig {
    provider: string;
    modelId: string;
    apiKey?: string;
    transcriptAllowed: boolean;
    codex?: import('../CodexCliService').CodexCliConfig;
}
type ValidationPost = (url: string, body: unknown, options: any) => Promise<{ status: number; data: any }>;
/** Shared fixed-input probe. Never receives a meeting prompt, transcript or tools. */
export async function requestSelectedAiModel(provider: string, modelId: string, apiKey: string, signal?: AbortSignal,
    post: ValidationPost = (url, body, options) => require('axios').post(url, body, options)): Promise<void> {
    if (provider !== 'doubao' && !(provider === 'natively' && modelId === 'natively')) throw new OnboardingError('unsupported_check');
    const requestModel = provider === 'natively' ? QCLOUD_CHAT_MODEL : modelId;
    const endpoint = provider === 'natively' ? QCLOUD_CHAT_COMPLETIONS_ENDPOINT : 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';
    if (!apiKey?.trim()) throw new OnboardingError('credentials_missing');
    try {
        const result = await post(endpoint,
            { model: requestModel, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16 },
            { headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, timeout: 15_000, signal });
        if (![200, 201].includes(result.status) || !result.data?.choices?.some((choice: any) => typeof choice.message?.content === 'string' && choice.message.content.trim())
            || (typeof result.data.model === 'string' && result.data.model !== requestModel)) throw new OnboardingError('model_unavailable');
    } catch (error) { throw new OnboardingError(signal?.aborted ? 'timeout' : validationErrorCode(error)); }
}
export function createAiExecutor(deps: {
    readSavedConfig(): SavedAiValidationConfig;
    post?: ValidationPost;
    validateCodex: (config: import('../CodexCliService').CodexCliConfig, signal: AbortSignal) => Promise<{ success: boolean; errorCode?: OnboardingErrorCode }>;
}): (check: OnboardingCheck, signal: AbortSignal) => Promise<ValidationEvidence> {
    return async (check, signal) => {
        if (signal.aborted) throw new OnboardingError('timeout');
        const config = deps.readSavedConfig();
        const { assertProviderDataScopes } = require('../../llm/ProviderRouter');
        try { assertProviderDataScopes(config.provider, ['transcript'], { transcript: config.transcriptAllowed }); }
        catch { throw new OnboardingError('scope_denied'); }
        if (config.provider !== check.provider || config.modelId !== check.modelId) throw new OnboardingError('stale_config');
        if (config.provider === 'codex') {
            if (!config.codex) throw new OnboardingError('unsupported_check');
            const result = await deps.validateCodex(config.codex, signal);
            if (!result.success) throw new OnboardingError(result.errorCode ?? 'unsupported_check');
        } else {
            await requestSelectedAiModel(config.provider, config.modelId, config.apiKey ?? '', signal, deps.post);
        }
        return { provider: config.provider, modelId: config.modelId, depth: 'model_response' };
    };
}
