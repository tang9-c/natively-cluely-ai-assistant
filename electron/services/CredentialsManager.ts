/**
 * CredentialsManager - Device-bound encrypted storage for API keys and service account paths
 */

import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type {
    BusinessSystemCredentialInput,
    BusinessSystemKnowledgeSource,
    BusinessSystemKnowledgeSourcePublic,
} from './business-system/BusinessSystemTypes';

export interface CustomProvider {
    id: string;
    name: string;
    curlCommand: string;
}

export interface CurlProvider {
    id: string;
    name: string;
    curlCommand: string;
    responsePath: string; // e.g. "choices[0].message.content"
}

export interface StoredCredentials {
    geminiApiKey?: string;
    groqApiKey?: string;
    openaiApiKey?: string;
    claudeApiKey?: string;
    googleServiceAccountPath?: string;
    customProviders?: CustomProvider[];
    curlProviders?: CurlProvider[];
    businessSystemKnowledgeSources?: BusinessSystemKnowledgeSource[];
    businessSystemCredentials?: Record<string, BusinessSystemCredentialInput>;
    defaultModel?: string;
    nativelyApiKey?: string;
    // STT Provider settings
    sttProvider?: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'doubao' | 'doubao-auc' | 'natively' | 'local-whisper' | 'local-sensevoice';
    groqSttApiKey?: string;
    groqSttModel?: string;
    openAiSttApiKey?: string;
    /** Custom OpenAI-compatible STT base URL (e.g. self-hosted Speaches).
     *  Empty / unset → use https://api.openai.com. */
    openAiSttBaseUrl?: string;
    deepgramApiKey?: string;
    elevenLabsApiKey?: string;
    azureApiKey?: string;
    azureRegion?: string;
    ibmWatsonApiKey?: string;
    ibmWatsonRegion?: string;
    sonioxApiKey?: string;
    doubaoApiKey?: string;
    doubaoLlmApiKey?: string;
    /** Doubao (Ark) embedding endpoint ID, e.g. ep-20260321165850-k9w7r */
    doubaoEmbeddingModel?: string;
    sttLanguage?: string;
    aiResponseLanguage?: string;
    // Tavily Search
    tavilyApiKey?: string;
    // Dynamic Model Discovery – preferred models per provider
    geminiPreferredModel?: string;
    groqPreferredModel?: string;
    openaiPreferredModel?: string;
    claudePreferredModel?: string;
    doubaoPreferredModel?: string;
    // Free trial state
    trialToken?: string;   // server-issued signed token (natively_trial_…)
    trialExpiresAt?: string;   // ISO timestamp — local copy for startup check
    trialStartedAt?: string;   // ISO timestamp
    trialClaimed?: boolean;  // set true on first claim, never cleared — hides start card permanently
}

export interface NativelyApiKeySaveOptions {
    selectAsDefault?: boolean;
}

export class CredentialsManager {
    private static instance: CredentialsManager;
    private credentials: StoredCredentials = {};

    private constructor() {
        // Load on construction after app ready
    }

    public static getInstance(): CredentialsManager {
        if (!CredentialsManager.instance) {
            CredentialsManager.instance = new CredentialsManager();
        }
        return CredentialsManager.instance;
    }

    /**
     * Initialize - load credentials from disk
     * Must be called after app.whenReady()
     */
    public init(): void {
        this.loadCredentials();
        console.log('[CredentialsManager] Initialized');
    }

    // =========================================================================
    // Getters
    // =========================================================================

    public getGeminiApiKey(): string | undefined {
        return this.credentials.geminiApiKey;
    }

    public getGroqApiKey(): string | undefined {
        return this.credentials.groqApiKey;
    }

    public getOpenaiApiKey(): string | undefined {
        return this.credentials.openaiApiKey;
    }

    public getClaudeApiKey(): string | undefined {
        return this.credentials.claudeApiKey;
    }

    public getGoogleServiceAccountPath(): string | undefined {
        return this.credentials.googleServiceAccountPath;
    }

    public getCustomProviders(): CustomProvider[] {
        return this.credentials.customProviders || [];
    }

    public getSttProvider(): 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'doubao' | 'doubao-auc' | 'natively' | 'local-whisper' | 'local-sensevoice' {
        const provider = this.credentials.sttProvider || 'none';
        if (provider === 'doubao') {
            this.credentials.sttProvider = 'doubao-auc';
            this.saveCredentials();
            console.log('[CredentialsManager] Self-healed sttProvider: doubao→doubao-auc (Doubao AUC is the implemented STT path)');
            return 'doubao-auc';
        }
        if (provider === 'natively') {
            this.credentials.sttProvider = 'local-sensevoice';
            this.saveCredentials();
            console.log('[CredentialsManager] Migrated STT provider: natively→local-sensevoice (QCLOUD does not provide default STT)');
            return 'local-sensevoice';
        }
        return provider;
    }

    public getDeepgramApiKey(): string | undefined {
        return this.credentials.deepgramApiKey;
    }

    public getGroqSttApiKey(): string | undefined {
        return this.credentials.groqSttApiKey;
    }

    public getGroqSttModel(): string {
        return this.credentials.groqSttModel || 'whisper-large-v3-turbo';
    }

    public getOpenAiSttApiKey(): string | undefined {
        return this.credentials.openAiSttApiKey;
    }

    public getOpenAiSttBaseUrl(): string | undefined {
        return this.credentials.openAiSttBaseUrl;
    }

    public getElevenLabsApiKey(): string | undefined {
        return this.credentials.elevenLabsApiKey;
    }

    public getAzureApiKey(): string | undefined {
        return this.credentials.azureApiKey;
    }

    public getAzureRegion(): string {
        return this.credentials.azureRegion || 'eastus';
    }

    public getIbmWatsonApiKey(): string | undefined {
        return this.credentials.ibmWatsonApiKey;
    }

    public getIbmWatsonRegion(): string {
        return this.credentials.ibmWatsonRegion || 'us-south';
    }

    public getSonioxApiKey(): string | undefined {
        return this.credentials.sonioxApiKey;
    }

    public getDoubaoApiKey(): string | undefined {
        return this.credentials.doubaoApiKey;
    }

    public getDoubaoAucApiKey(): string | undefined {
        return this.credentials.doubaoApiKey; // Reuse same key for now
    }

    public getDoubaoLlmApiKey(): string | undefined {
        return this.credentials.doubaoLlmApiKey;
    }

    public getDoubaoEmbeddingModel(): string | undefined {
        return this.credentials.doubaoEmbeddingModel;
    }

    public getTavilyApiKey(): string | undefined {
        return this.credentials.tavilyApiKey;
    }

    public getSttLanguage(): string {
        return this.credentials.sttLanguage || 'english-us';
    }

    public getAiResponseLanguage(): string {
        return this.credentials.aiResponseLanguage || 'Chinese';
    }
    public getDefaultModel(): string {
        return this.credentials.defaultModel || 'gemini-3.1-flash-lite-preview';
    }

    public getNativelyApiKey(): string | undefined {
        return this.credentials.nativelyApiKey;
    }

    public getAllCredentials(): StoredCredentials {
        return { ...this.credentials };
    }

    // =========================================================================
    // Vision provider availability — used by the vision-first screen pipeline
    // =========================================================================

    /**
     * True if at least one configured provider is vision-capable.
     * Used by ScreenUnderstandingService to gate vision_only / decide fallback.
     */
    public anyVisionProviderConfigured(): boolean {
        if (this.credentials.nativelyApiKey) return true;       // QCLOUD API supports vision
        if (this.credentials.openaiApiKey) return true;          // gpt-4o / gpt-5 vision
        if (this.credentials.claudeApiKey) return true;          // Claude vision
        if (this.credentials.geminiApiKey) return true;          // Gemini vision
        if (this.credentials.groqApiKey) return true;            // Groq llama-4-scout vision
        // Custom providers: only count if they have screenshots scope AND multimodal flag
        const custom = this.credentials.customProviders || [];
        if (custom.some(p => (p as any)?.multimodal === true)) return true;
        return this.anyLocalVisionProviderConfigured();
    }

    /**
     * True if at least one LOCAL vision provider is configured (Ollama vision model,
     * Codex CLI with vision support, or a local-only custom provider).
     * Used by private_vision mode to enforce no cloud-vision calls.
     */
    public anyLocalVisionProviderConfigured(): boolean {
        // Ollama: caller verifies the configured model is vision-capable via modelCapabilities.
        // Here we only assert the runtime is configured — model gating happens in the chain.
        const ollamaBaseUrl = (this.credentials as any).ollamaBaseUrl as string | undefined;
        if (ollamaBaseUrl && ollamaBaseUrl.trim().length > 0) return true;
        // Codex CLI is local in normal install — capability is verified by ProviderRouter.
        const codexCliPath = (this.credentials as any).codexCliPath as string | undefined;
        if (codexCliPath && codexCliPath.trim().length > 0) return true;
        return false;
    }

    // =========================================================================
    // Setters (auto-save)
    // =========================================================================

    public setGeminiApiKey(key: string): void {
        this.credentials.geminiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Gemini API Key updated');
    }

    public setGroqApiKey(key: string): void {
        this.credentials.groqApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq API Key updated');
    }

    public setOpenaiApiKey(key: string): void {
        this.credentials.openaiApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI API Key updated');
    }

    public setClaudeApiKey(key: string): void {
        this.credentials.claudeApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Claude API Key updated');
    }

    public setGoogleServiceAccountPath(filePath: string): void {
        this.credentials.googleServiceAccountPath = filePath;
        this.saveCredentials();
        console.log('[CredentialsManager] Google Service Account path updated');
    }

    public setSttProvider(provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'doubao' | 'doubao-auc' | 'natively' | 'local-whisper' | 'local-sensevoice'): void {
        if (provider === 'doubao') {
            provider = 'doubao-auc';
        }
        this.credentials.sttProvider = provider;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Provider set to: ${provider}`);
    }

    public setDeepgramApiKey(key: string): void {
        this.credentials.deepgramApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Deepgram API Key updated');
    }

    public setGroqSttApiKey(key: string): void {
        this.credentials.groqSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Groq STT API Key updated');
    }

    public setOpenAiSttApiKey(key: string): void {
        this.credentials.openAiSttApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] OpenAI STT API Key updated');
    }

    public setOpenAiSttBaseUrl(url: string): void {
        // Store undefined (not empty string) when clearing, so callers can fall back
        // to the default api.openai.com endpoint with a simple truthiness check.
        const trimmed = url.trim();
        this.credentials.openAiSttBaseUrl = trimmed || undefined;
        this.saveCredentials();
        console.log(`[CredentialsManager] OpenAI STT Base URL set to: ${trimmed || '(default)'}`);
    }

    public setGroqSttModel(model: string): void {
        this.credentials.groqSttModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Groq STT Model set to: ${model}`);
    }

    public setElevenLabsApiKey(key: string): void {
        this.credentials.elevenLabsApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] ElevenLabs API Key updated');
    }

    public setAzureApiKey(key: string): void {
        this.credentials.azureApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Azure API Key updated');
    }

    public setAzureRegion(region: string): void {
        this.credentials.azureRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] Azure Region set to: ${region}`);
    }

    public setIbmWatsonApiKey(key: string): void {
        this.credentials.ibmWatsonApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] IBM Watson API Key updated');
    }

    public setIbmWatsonRegion(region: string): void {
        this.credentials.ibmWatsonRegion = region;
        this.saveCredentials();
        console.log(`[CredentialsManager] IBM Watson Region set to: ${region}`);
    }

    public setSonioxApiKey(key: string): void {
        this.credentials.sonioxApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Soniox API Key updated');
    }

    public setDoubaoApiKey(key: string): void {
        this.credentials.doubaoApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Doubao API Key updated');
    }

    public setDoubaoAucApiKey(key: string): void {
        this.credentials.doubaoApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Doubao AUC API Key updated');
    }

    public setDoubaoLlmApiKey(key: string): void {
        this.credentials.doubaoLlmApiKey = key;
        this.saveCredentials();
        console.log('[CredentialsManager] Doubao LLM API Key updated');
    }

    public setDoubaoEmbeddingModel(model: string): void {
        this.credentials.doubaoEmbeddingModel = model.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Doubao Embedding model updated');
    }

    public setTavilyApiKey(key: string): void {
        // Store undefined (not empty string) when removing, so hasKey() checks stay consistent
        this.credentials.tavilyApiKey = key.trim() || undefined;
        this.saveCredentials();
        console.log('[CredentialsManager] Tavily API Key updated');
    }

    public setSttLanguage(language: string): void {
        this.credentials.sttLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] STT Language set to: ${language}`);
    }

    public setAiResponseLanguage(language: string): void {
        this.credentials.aiResponseLanguage = language;
        this.saveCredentials();
        console.log(`[CredentialsManager] AI Response Language set to: ${language}`);
    }
    public setDefaultModel(model: string): void {
        this.credentials.defaultModel = model;
        this.saveCredentials();
        console.log(`[CredentialsManager] Default Model set to: ${model}`);
    }

    private shouldPromoteQCloudDefault(currentModel: string | undefined, options?: NativelyApiKeySaveOptions): boolean {
        if (options?.selectAsDefault === true) return true;
        const current = currentModel || '';
        if (!current || current === 'natively') return true;
        return current.startsWith('gemini-')
            || current.startsWith('llama-')
            || current.startsWith('mixtral-')
            || current.startsWith('gemma-')
            || current === 'gemini'
            || current === 'llama';
    }

    public setNativelyApiKey(key: string, options?: NativelyApiKeySaveOptions): void {
        const trimmed = key.trim();
        this.credentials.nativelyApiKey = trimmed || undefined;

        if (trimmed && this.shouldPromoteQCloudDefault(this.credentials.defaultModel, options)) {
            this.credentials.defaultModel = 'natively';
            console.log('[CredentialsManager] Auto-set default model to QCLOUD');
        } else if (!trimmed) {
            // Key cleared — revert natively-auto-set defaults back to safe fallbacks
            if (this.credentials.defaultModel === 'natively') {
                this.credentials.defaultModel = 'gemini-3.1-flash-lite-preview';
                console.log('[CredentialsManager] QCLOUD key cleared — reset default model to Gemini Flash');
            }
            if (this.credentials.sttProvider === 'natively') {
                this.credentials.sttProvider = 'local-sensevoice';
                console.log('[CredentialsManager] QCLOUD key cleared — migrated STT provider to local-sensevoice');
            }
        }

        this.saveCredentials();
        console.log('[CredentialsManager] QCLOUD key updated');
    }

    public getPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao'): string | undefined {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        return this.credentials[key] as string | undefined;
    }

    public setPreferredModel(provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao', modelId: string): void {
        const key = `${provider}PreferredModel` as keyof StoredCredentials;
        (this.credentials as any)[key] = modelId;
        this.saveCredentials();
        console.log(`[CredentialsManager] ${provider} preferred model set to: ${modelId}`);
    }

    public saveCustomProvider(provider: CustomProvider): void {
        if (!this.credentials.customProviders) {
            this.credentials.customProviders = [];
        }
        // Check if exists, update if so
        const index = this.credentials.customProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.customProviders[index] = provider;
        } else {
            this.credentials.customProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${provider.name}' saved`);
    }

    public deleteCustomProvider(id: string): void {
        if (!this.credentials.customProviders) return;
        this.credentials.customProviders = this.credentials.customProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Custom Provider '${id}' deleted`);
    }

    public getCurlProviders(): CurlProvider[] {
        return this.credentials.curlProviders || [];
    }

    public getBusinessSystemKnowledgeSources(): BusinessSystemKnowledgeSource[] {
        return [...(this.credentials.businessSystemKnowledgeSources || [])];
    }

    public getBusinessSystemKnowledgeSourcesPublic(): BusinessSystemKnowledgeSourcePublic[] {
        const credentialsBySource = this.credentials.businessSystemCredentials || {};
        return this.getBusinessSystemKnowledgeSources().map((source) => {
            const credential = credentialsBySource[source.id] || {};
            return {
                ...source,
                credentialState: {
                    hasApiKey: Boolean(credential.apiKey),
                    hasUsername: Boolean(credential.username),
                    hasPassword: Boolean(credential.password),
                },
            };
        });
    }

    public getBusinessSystemCredentials(sourceId: string): BusinessSystemCredentialInput | undefined {
        const credentials = this.credentials.businessSystemCredentials || {};
        const credential = credentials[sourceId];
        return credential ? { ...credential } : undefined;
    }

    public saveBusinessSystemKnowledgeSource(
        source: BusinessSystemKnowledgeSource,
        credential?: BusinessSystemCredentialInput,
    ): void {
        const now = new Date().toISOString();
        const sources = this.credentials.businessSystemKnowledgeSources || [];
        const normalized: BusinessSystemKnowledgeSource = {
            ...source,
            name: source.name.trim(),
            url: source.url.trim(),
            createdAt: source.createdAt || now,
            updatedAt: now,
        };
        const nextSources = sources.filter((item) => item.id !== normalized.id);
        const withDefaultApplied = normalized.isDefault
            ? nextSources.map((item) => ({ ...item, isDefault: false }))
            : nextSources;
        this.credentials.businessSystemKnowledgeSources = [...withDefaultApplied, normalized];

        if (credential) {
            const current = this.credentials.businessSystemCredentials || {};
            this.credentials.businessSystemCredentials = {
                ...current,
                [normalized.id]: {
                    apiKey: credential.apiKey?.trim() || undefined,
                    username: credential.username?.trim() || undefined,
                    password: credential.password || undefined,
                },
            };
        }

        this.saveCredentials();
        console.log('[CredentialsManager] Business system knowledge source saved', {
            id: normalized.id,
            kind: normalized.kind,
            authType: normalized.authType,
            enabled: normalized.enabled,
        });
    }

    public deleteBusinessSystemKnowledgeSource(sourceId: string): void {
        this.credentials.businessSystemKnowledgeSources = (this.credentials.businessSystemKnowledgeSources || [])
            .filter((source) => source.id !== sourceId);
        if (this.credentials.businessSystemCredentials) {
            delete this.credentials.businessSystemCredentials[sourceId];
        }
        this.saveCredentials();
        console.log('[CredentialsManager] Business system knowledge source deleted', { id: sourceId });
    }

    public saveCurlProvider(provider: CurlProvider): void {
        if (!this.credentials.curlProviders) {
            this.credentials.curlProviders = [];
        }
        const index = this.credentials.curlProviders.findIndex(p => p.id === provider.id);
        if (index !== -1) {
            this.credentials.curlProviders[index] = provider;
        } else {
            this.credentials.curlProviders.push(provider);
        }
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${provider.name}' saved`);
    }

    public deleteCurlProvider(id: string): void {
        if (!this.credentials.curlProviders) return;
        this.credentials.curlProviders = this.credentials.curlProviders.filter(p => p.id !== id);
        this.saveCredentials();
        console.log(`[CredentialsManager] Curl Provider '${id}' deleted`);
    }

    // ── Free Trial ─────────────────────────────────────────────
    public getTrialToken(): string | undefined {
        return this.credentials.trialToken;
    }

    public getTrialExpiresAt(): string | undefined {
        return this.credentials.trialExpiresAt;
    }

    public getTrialStartedAt(): string | undefined {
        return this.credentials.trialStartedAt;
    }

    public getTrialClaimed(): boolean {
        return this.credentials.trialClaimed === true;
    }

    public setTrialToken(token: string, expiresAt: string, startedAt: string): void {
        this.credentials.trialToken = token;
        this.credentials.trialExpiresAt = expiresAt;
        this.credentials.trialStartedAt = startedAt;
        this.credentials.trialClaimed = true;
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token stored, expires:', expiresAt);
    }

    public clearTrialToken(): void {
        delete this.credentials.trialToken;
        delete this.credentials.trialExpiresAt;
        delete this.credentials.trialStartedAt;
        // trialClaimed intentionally NOT cleared — keeps start card hidden after token wipe
        this.saveCredentials();
        console.log('[CredentialsManager] Trial token cleared');
    }

    public clearAll(): void {
        this.scrubMemory();
        const credentialsPath = this.credentialsFilePath();
        if (fs.existsSync(credentialsPath)) {
            fs.unlinkSync(credentialsPath);
        }
        console.log('[CredentialsManager] All credentials cleared');
    }

    /**
     * Scrub all API keys from memory to minimize exposure window.
     * Called on app quit and credential clear.
     */
    public scrubMemory(): void {
        const businessCredentials = this.credentials.businessSystemCredentials || {};
        for (const credential of Object.values(businessCredentials)) {
            if (typeof credential.apiKey === 'string') credential.apiKey = '';
            if (typeof credential.username === 'string') credential.username = '';
            if (typeof credential.password === 'string') credential.password = '';
        }

        // Overwrite each string field with empty before discarding
        for (const key of Object.keys(this.credentials) as (keyof StoredCredentials)[]) {
            const val = this.credentials[key];
            if (typeof val === 'string') {
                (this.credentials as any)[key] = '';
            }
        }
        this.credentials = {};
        console.log('[CredentialsManager] Memory scrubbed');
    }

    // =========================================================================
    // Storage (Encrypted)
    // =========================================================================

    private credentialsFilePath(): string {
        return path.join(app.getPath('userData'), 'credentials.enc');
    }

    private saveCredentials(): void {
        try {
            fs.writeFileSync(
                this.credentialsFilePath(),
                JSON.stringify(this.credentials, null, 2),
                'utf8'
            );
        } catch (error) {
            console.error('[CredentialsManager] Failed to save credentials:', error);
            throw error;
        }
    }

    private loadCredentials(): void {
        const filePath = this.credentialsFilePath();
        if (!fs.existsSync(filePath)) {
            this.credentials = {};
            console.log('[CredentialsManager] No stored credentials found');
            return;
        }
        try {
            const raw = fs.readFileSync(filePath, 'utf8');
            this.credentials = JSON.parse(raw);
            console.log('[CredentialsManager] Loaded credentials');
        } catch (error) {
            console.error('[CredentialsManager] Failed to load credentials:', error);
            this.credentials = {};
        }
    }
}
