import fs from 'fs';
import path from 'path';
import type { OnboardingCheck, OnboardingSnapshot, ValidationTarget } from '../../../shared/onboarding';
import { DEFAULT_CHAT_MODEL_ID } from '../CredentialsManager';
import type { CredentialsManager, StoredCredentials } from '../CredentialsManager';
import { SENSEVOICE_DEFAULT_MODEL_ID } from '../../audio/sensevoice/types';
import type { SettingsManager } from '../SettingsManager';
import { OnboardingService } from './OnboardingService';

export interface ModelIdentityMetadata {
    runtime: string | Record<string, unknown>;
    files: { name: string; size: number; mtimeMs: number }[];
}
interface ConfigurationSources {
    settings: SettingsManager;
    credentials: CredentialsManager;
    database: { hasNonDemoMeeting(): boolean };
    readConfiguration?: (target: ValidationTarget) => OnboardingCheck;
    saveProgress?: (progress: import('../../../shared/onboarding').OnboardingProgress) => void;
    readChecks?: (selection?: OnboardingSnapshot['devices']) => Promise<OnboardingSnapshot['checks']>;
    readModelMetadata?: (provider: string, modelId: string) => ModelIdentityMetadata;
    runtimeVersion?: string;
    now?: () => number;
    platform?: () => string;
}
function endpointIdentity(value?: string): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        // Query values, userinfo and fragments may carry credentials, even in legacy settings.
        return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
    } catch { return 'invalid_endpoint'; }
}
function fileMetadata(files: string[]): ModelIdentityMetadata['files'] {
    return files.map(file => {
        try { const stat = fs.statSync(file); return { name: path.basename(file), size: stat.size, mtimeMs: stat.mtimeMs }; }
        catch { return { name: path.basename(file), size: -1, mtimeMs: -1 }; }
    });
}
function modelMetadata(provider: string, modelId: string): ModelIdentityMetadata {
    if (provider === 'local-sensevoice') {
        const { resolveSenseVoiceModelFiles } = require('../../audio/sensevoice/modelManager');
        const { modelFile, tokensFile } = resolveSenseVoiceModelFiles(modelId);
        return { runtime: `sherpa-onnx:${process.platform}:${process.arch}`, files: fileMetadata([modelFile, tokensFile]) };
    }
    if (provider === 'local-whisper') {
        const { getModelsDir } = require('../../audio/whisper/modelManager');
        const { resolveInferenceConfig } = require('../../audio/whisper/inferenceConfig');
        const root = path.resolve(getModelsDir());
        const directory = path.resolve(root, modelId);
        if (!directory.startsWith(root + path.sep)) return { runtime: 'invalid_model', files: [] };
        const files: string[] = [];
        for (const sub of ['', 'onnx']) {
            const folder = path.join(directory, sub);
            try { for (const name of fs.readdirSync(folder).sort()) {
                if (/\.(onnx|json|txt)$/.test(name)) files.push(path.join(folder, name));
            } } catch { /* Missing files remain unverified; no download is initiated here. */ }
        }
        return { runtime: { ...resolveInferenceConfig(), platform: process.platform, arch: process.arch }, files: fileMetadata(files) };
    }
    return { runtime: 'cloud', files: [] };
}
/** Configuration identity only. Actual execution and routing stay with the existing providers. */
export function readOnboardingConfiguration(sources: ConfigurationSources, target: ValidationTarget): OnboardingCheck {
    const { credentials: cm, settings: sm } = sources;
    const raw = cm.getAllCredentials();
    const versions = (keys: (keyof StoredCredentials)[]) => keys.map(key => cm.getCredentialVersion(key) ?? 'unversioned');
    if (target === 'stt') {
        const savedProvider = raw.sttProvider ?? 'none';
        const provider = savedProvider === 'doubao' ? 'doubao-auc'
            : savedProvider === 'natively' ? (raw.nativelyApiKey ? 'qcloud-stt' : 'local-sensevoice')
            : savedProvider === 'qcloud-stt' && !raw.nativelyApiKey ? 'local-sensevoice' : savedProvider;
        const local = provider === 'local-sensevoice' || provider === 'local-whisper';
        const modelId = provider === 'local-whisper' ? sm.get('localWhisperModel') ?? 'Xenova/whisper-base'
            : provider === 'local-sensevoice' ? SENSEVOICE_DEFAULT_MODEL_ID : provider === 'groq' ? cm.getGroqSttModel() : provider;
        const secretKeys: Partial<Record<typeof provider, keyof StoredCredentials>> = {
            google: 'googleServiceAccountPath', groq: 'groqSttApiKey', openai: 'openAiSttApiKey', deepgram: 'deepgramApiKey',
            elevenlabs: 'elevenLabsApiKey', azure: 'azureApiKey', ibmwatson: 'ibmWatsonApiKey', soniox: 'sonioxApiKey',
            'doubao-auc': 'doubaoApiKey', 'qcloud-stt': 'nativelyApiKey' };
        const key = secretKeys[provider];
        const metadata = local ? (sources.readModelMetadata ?? modelMetadata)(provider, modelId) : undefined;
        const identity = JSON.stringify({ provider, modelId, language: cm.getSttLanguage(),
            endpoint: provider === 'openai' ? endpointIdentity(cm.getOpenAiSttBaseUrl() ?? 'https://api.openai.com') : undefined,
            region: provider === 'azure' ? cm.getAzureRegion() : provider === 'ibmwatson' ? cm.getIbmWatsonRegion() : undefined,
            channels: provider === 'local-whisper' ? { enabled: sm.get('localWhisperPerChannelEnabled') === true,
                mic: sm.get('localWhisperModelMic') || modelId, system: sm.get('localWhisperModelSystem') || modelId,
                metadata: sm.get('localWhisperPerChannelEnabled') === true ? [
                    (sources.readModelMetadata ?? modelMetadata)(provider, sm.get('localWhisperModelMic') || modelId),
                    (sources.readModelMetadata ?? modelMetadata)(provider, sm.get('localWhisperModelSystem') || modelId),
                ] : undefined } : undefined,
            credentialFile: provider === 'google' && raw.googleServiceAccountPath ? fileMetadata([raw.googleServiceAccountPath]) : undefined,
            runtimeVersion: local ? sources.runtimeVersion ?? process.versions.electron ?? process.versions.node : undefined,
            metadata, credentialVersions: key ? versions([key]) : [] });
        const missing = provider === 'none' || (!local && (!key || !raw[key] || !cm.getCredentialVersion(key)));
        return { status: 'missing', provider, modelId, configured: local || !!(key && raw[key]), configIdentity: identity,
            qcloudKeyConfigured: !!raw.nativelyApiKey, languageKey: cm.getSttLanguage(),
            ...(missing ? { errorCode: 'credentials_missing' as const } : {}) };
    }
    const modelId = cm.getDefaultModel();
    const codex = modelId === 'codex-cli' || modelId.startsWith('codex-cli:');
    const provider = codex ? 'codex' : modelId === 'natively' ? 'natively'
        : /^(doubao-|volc\.|ep-)/.test(modelId) ? 'doubao' : /^claude-/.test(modelId) ? 'claude'
        : /^(gemini-|models\/)/.test(modelId) ? 'gemini' : /^(gpt-|o1-|o3-)/.test(modelId) ? 'openai'
        : /^(llama-|mixtral-|gemma-)/.test(modelId) ? 'groq' : 'custom';
    const keys: Record<string, keyof StoredCredentials> = { doubao: 'doubaoLlmApiKey', natively: 'nativelyApiKey',
        claude: 'claudeApiKey', gemini: 'geminiApiKey', openai: 'openaiApiKey', groq: 'groqApiKey' };
    const key = keys[provider];
    const configIdentity = JSON.stringify({ provider, modelId, responseLanguage: cm.getAiResponseLanguage(),
        credentialVersions: key ? versions([key]) : versions(['customProviders', 'curlProviders']),
        preferredModels: [raw.geminiPreferredModel, raw.groqPreferredModel, raw.openaiPreferredModel, raw.claudePreferredModel, raw.doubaoPreferredModel],
        transcriptAllowed: sm.get('providerDataScopes')?.transcript !== false,
        codex: codex ? { enabled: sm.get('codexCliEnabled'), path: sm.get('codexCliPath'), model: sm.get('codexCliModel'),
            timeoutMs: sm.get('codexCliTimeoutMs'), sandboxMode: sm.get('codexCliSandboxMode') } : undefined });
    return { status: 'missing', provider, modelId, configured: key ? !!raw[key] : codex ? sm.get('codexCliEnabled') === true : !!raw.customProviders?.length || !!raw.curlProviders?.length, configIdentity,
        qcloudKeyConfigured: !!raw.nativelyApiKey,
        modelName: provider === 'custom' ? [...(raw.customProviders ?? []), ...(raw.curlProviders ?? [])].find(provider => provider.id === modelId)?.name : undefined,
        ...(sm.get('providerDataScopes')?.transcript === false ? { errorCode: 'scope_denied' as const }
            : key && (!raw[key] || !cm.getCredentialVersion(key)) ? { errorCode: 'credentials_missing' as const } : {}) };
}

/** Created after app ready; initialization waits for the Launcher's legacy evidence in T07. */
export function createOnboardingService(sources: ConfigurationSources): OnboardingService {
    const { settings, credentials, database } = sources;
    const service = new OnboardingService({
        load: () => {
            if (settings.hasLoadError()) throw new Error('settings_unavailable');
            return settings.get('onboarding');
        },
        save: sources.saveProgress ?? (progress => settings.set('onboarding', progress)),
        readLegacyEvidence: () => {
            if (settings.hasLoadError() || credentials.hasLoadError()) throw new Error('configuration_unavailable');
            const raw = credentials.getAllCredentials();
            return { hasNonDemoMeeting: database.hasNonDemoMeeting(), hasSavedServiceConfiguration:
                !!raw.sttProvider && raw.sttProvider !== 'none' || !!raw.defaultModel && raw.defaultModel !== DEFAULT_CHAT_MODEL_ID
                || Object.entries(raw).some(([key, value]) => key.endsWith('ApiKey') && !!value)
                || !!raw.googleServiceAccountPath || !!raw.customProviders?.length || !!raw.curlProviders?.length
                || settings.get('codexCliEnabled') === true || !!settings.get('codexCliPath') && settings.get('codexCliPath') !== 'codex'
                || !!settings.get('localWhisperModel') && settings.get('localWhisperModel') !== 'Xenova/whisper-base' };
        },
        readChecks: sources.readChecks ?? (async () => ({ microphone: { status: 'missing' }, inputDevice: { status: 'missing' },
            systemAudio: { status: 'missing' }, stt: { status: 'missing' }, ai: { status: 'missing' } })),
        readConfiguration: sources.readConfiguration ?? (target => readOnboardingConfiguration(sources, target)),
        now: sources.now ?? Date.now, platform: sources.platform ?? (() => process.platform),
    });
    settings.onConfigurationChanged(target => service.invalidate(target));
    credentials.onConfigurationChanged(target => service.invalidate(target));
    return service;
}

/** Explicit save/validation only: passive snapshots never mint credential versions. */
export function prepareOnboardingCredentials(sources: { credentials: CredentialsManager; settings: SettingsManager }, target: ValidationTarget): void {
    const check = readOnboardingConfiguration({ ...sources, database: { hasNonDemoMeeting: () => false } }, target);
    const sttKeys: Record<string, keyof StoredCredentials> = { groq: 'groqSttApiKey', openai: 'openAiSttApiKey',
        'doubao-auc': 'doubaoApiKey', 'qcloud-stt': 'nativelyApiKey', azure: 'azureApiKey', ibmwatson: 'ibmWatsonApiKey' };
    const aiKeys: Record<string, keyof StoredCredentials> = { doubao: 'doubaoLlmApiKey', natively: 'nativelyApiKey' };
    const key = (target === 'stt' ? sttKeys : aiKeys)[check.provider ?? ''];
    if (key) sources.credentials.ensureCredentialVersion(key);
}
