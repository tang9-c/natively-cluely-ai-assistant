import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import { sanitizeSenseVoiceTerms, validateSenseVoiceTerms } from '../audio/sensevoice/termCorrection';
import { mergeSenseVoiceTermCorrections, DEFAULT_SENSEVOICE_TERM_CORRECTIONS } from '../audio/sensevoice/defaultTermCorrections';
import type { SenseVoiceTermCorrectionConfig, SenseVoiceTermEntry } from '../audio/sensevoice/types';

export interface AppSettings {
    // Only boot-critical or non-encrypted settings should live here.
    // In the future, other non-secret data like 'language' or 'theme'
    // can be moved here from CredentialsManager to allow early boot access.
    verboseLogging?: boolean;
    actionButtonMode?: 'recap' | 'brainstorm';
    codexCliEnabled?: boolean;
    codexCliPath?: string;
    codexCliModel?: string;
    codexCliTimeoutMs?: number;
    codexCliSandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access';
    knowledgeMode?: boolean;
    // Internal rollout/rollback gate. This is not an MCP authorization policy.
    nativeMcpToolCallingEnabled?: boolean;
    localWhisperModel?: string;
    // Per-channel model overrides for local Whisper. When
    // localWhisperPerChannelEnabled is true, the two LocalWhisperSTT instances
    // pick their own model (mic / system) instead of sharing localWhisperModel.
    // Use case: tiny model for the user's own voice (predictable, fast) + a
    // larger one for system audio (varied accents / jargon).
    localWhisperPerChannelEnabled?: boolean;
    localWhisperModelMic?: string;
    localWhisperModelSystem?: string;
    localSenseVoiceTerms?: SenseVoiceTermEntry[];
    localSenseVoiceTermsRevision?: number;
    localSenseVoiceCorrectionEnabled?: boolean;
    // Phase 6 — TelemetryService toggle. Defaults to true (local-only JSONL).
    // When false, no telemetry is written to disk and no sinks fire.
    telemetryEnabled?: boolean;
    // Phase 9 — privacy/retention controls. Foundation only. Encryption is
    // documented in docs/engineering/LOCAL_DB_ENCRYPTION_DESIGN.md.
    // 'forever' (default), '7d', '30d', or 'never' (do not store transcripts).
    meetingRetention?: 'forever' | '7d' | '30d' | 'never';
    providerDataScopes?: {
        transcript?: boolean;
        screenshots?: boolean;
        reference_files?: boolean;
        profile_history?: boolean;
        embeddings?: boolean;
        post_call_summary?: boolean;
    };
    // Screen-understanding routing — VISION-ONLY architecture (legacy OCR removed from runtime).
    //   vision_first   — Default. Send screenshot to the first available vision-capable provider; cascade through fallback chain on failure.
    //   vision_only    — Stricter: require vision-capable provider. No text-only provider fallback. No OCR fallback.
    //   private_vision — Local vision only (Ollama image-capable / Codex local / approved local custom). Never call cloud vision. Hard error if no local vision provider available.
    screenUnderstandingMode?: 'vision_first' | 'vision_only' | 'private_vision';
    // When true (default) and the active mode is a technical / coding interview, prefer
    // direct vision LLM over structured-extract-then-answer for lowest latency.
    technicalInterviewVisionFirst?: boolean;
    // Optional offline/multilingual intent enhancement. Defaults to false so
    // Chinese intent recognition uses rules + cloud fallback without pulling
    // the large local mDeBERTa artifact.
    localIntentEnhancementEnabled?: boolean;
    defaultActiveSkillIds?: string[];
    skillsAutoTriggerEnabled?: boolean;
    skillsWatcherEnabled?: boolean;
    skillsWatcherAutoActivateThreshold?: number;
    skillsWatcherSuggestThreshold?: number;
    speakerSeparationMode?: 'auto' | 'off';
    speakerVerificationMode?: 'off' | 'local';
}

export const VALID_SCREEN_UNDERSTANDING_MODES = ['vision_first', 'vision_only', 'private_vision'] as const;
export type ScreenUnderstandingMode = typeof VALID_SCREEN_UNDERSTANDING_MODES[number];

// LEGACY values kept ONLY for migration of existing settings.json files written by older builds.
// New code MUST NOT branch on these — they are normalized to a VALID_SCREEN_UNDERSTANDING_MODES value on load.
const LEGACY_SCREEN_MODE_MIGRATION: Record<string, ScreenUnderstandingMode> = {
    auto: 'vision_first',
    balanced: 'vision_first',
    best: 'vision_first',
    fast: 'vision_first',
    ocr_only: 'vision_first',
    private: 'private_vision',
};

export class SettingsManager {
    private static instance: SettingsManager;
    private settings: AppSettings = {};
    private settingsPath: string;

    private constructor() {
        if (!app.isReady()) {
            throw new Error('[SettingsManager] Cannot initialize before app.whenReady()');
        }
        this.settingsPath = path.join(app.getPath('userData'), 'settings.json');
        this.loadSettings();
    }

    public static getInstance(): SettingsManager {
        if (!SettingsManager.instance) {
            SettingsManager.instance = new SettingsManager();
        }
        return SettingsManager.instance;
    }

    public get<K extends keyof AppSettings>(key: K): AppSettings[K] {
        return this.settings[key];
    }

    public set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
        const hadPreviousValue = Object.prototype.hasOwnProperty.call(this.settings, key);
        const previousValue = this.settings[key];
        this.settings[key] = value;
        try {
            this.saveSettings();
        } catch (error) {
            if (hadPreviousValue) {
                this.settings[key] = previousValue;
            } else {
                Reflect.deleteProperty(this.settings, key);
            }
            throw error;
        }
    }

    // Resolved screen-understanding mode with default and runtime validation.
    // Use this instead of get('screenUnderstandingMode') from callers so the default applies consistently.
    public getScreenUnderstandingMode(): ScreenUnderstandingMode {
        const stored = this.settings.screenUnderstandingMode;
        if (stored && (VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(stored)) {
            return stored;
        }
        return 'vision_first';
    }

    public setScreenUnderstandingMode(mode: ScreenUnderstandingMode): void {
        if (!(VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(mode)) {
            throw new Error(`[SettingsManager] Invalid screenUnderstandingMode: ${mode}`);
        }
        this.settings.screenUnderstandingMode = mode;
        this.saveSettings();
    }

    public getTechnicalInterviewVisionFirst(): boolean {
        return this.settings.technicalInterviewVisionFirst !== false;
    }

    public getNativeMcpToolCallingEnabled(): boolean {
        return this.settings.nativeMcpToolCallingEnabled !== false;
    }

    public getLocalIntentEnhancementEnabled(): boolean {
        return this.settings.localIntentEnhancementEnabled === true;
    }

    public getLocalSenseVoiceTermCorrectionConfig(): SenseVoiceTermCorrectionConfig {
        return {
            terms: mergeSenseVoiceTermCorrections(this.settings.localSenseVoiceTerms ?? []),
            enabled: this.settings.localSenseVoiceCorrectionEnabled !== false,
        };
    }

    public getLocalSenseVoiceTermSettings() {
        const config = this.getLocalSenseVoiceTermCorrectionConfig();
        return { terms: config.terms, correctionEnabled: config.enabled, revision: this.settings.localSenseVoiceTermsRevision ?? 0 };
    }

    private saveLocalSenseVoiceTerms(terms: SenseVoiceTermEntry[], enabled: boolean) {
        const previous = this.settings;
        this.settings = { ...previous, localSenseVoiceTerms: terms, localSenseVoiceCorrectionEnabled: enabled,
            localSenseVoiceTermsRevision: (previous.localSenseVoiceTermsRevision ?? 0) + 1 };
        try { this.saveSettings(); }
        catch { this.settings = previous; throw new Error('词表保存失败，请重试。'); }
        return { success: true, enabled, revision: this.settings.localSenseVoiceTermsRevision };
    }

    public setLocalSenseVoiceTerms(input: { terms: unknown; revision: number; correctionEnabled?: boolean }) {
        try {
            if (!input || input.revision !== (this.settings.localSenseVoiceTermsRevision ?? 0)) {
                return { success: false, error: '词表已变化。表单已保留，请刷新词表后重试。' };
            }
            const terms = validateSenseVoiceTerms(input.terms, DEFAULT_SENSEVOICE_TERM_CORRECTIONS.length + 200);
            const defaults = new Map(DEFAULT_SENSEVOICE_TERM_CORRECTIONS.map(term => [term.canonical.toLowerCase(), term]));
            const overrides = terms.filter(term => JSON.stringify(term) !== JSON.stringify(defaults.get(term.canonical.toLowerCase())));
            for (const term of DEFAULT_SENSEVOICE_TERM_CORRECTIONS) {
                if (!terms.some(value => value.canonical.toLowerCase() === term.canonical.toLowerCase())) overrides.push({ ...term, enabled: false });
            }
            return this.saveLocalSenseVoiceTerms(validateSenseVoiceTerms(overrides), input.correctionEnabled ?? this.getLocalSenseVoiceTermCorrectionConfig().enabled);
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '词表保存失败。' }; }
    }

    public addLocalSenseVoiceTermPair(variant: string, canonical: string) {
        try {
            const [pair] = validateSenseVoiceTerms([{ canonical, variants: [variant], enabled: true }]);
            const config = this.getLocalSenseVoiceTermCorrectionConfig();
            const matched = config.terms.find(term => term.variants.some(value => value.toLowerCase() === pair.variants[0].toLowerCase()));
            if (matched && matched.canonical.toLowerCase() !== pair.canonical.toLowerCase()) {
                return { success: false, error: '同一错词已有不同正确词，请到原词表管理页处理冲突。' };
            }
            if (matched) return { success: true, enabled: config.enabled && matched.enabled };
            const existing = config.terms.find(term => term.canonical.toLowerCase() === pair.canonical.toLowerCase());
            const merged = existing ? { ...existing, variants: [...existing.variants, pair.variants[0]] } : pair;
            const userTerms = sanitizeSenseVoiceTerms(this.settings.localSenseVoiceTerms ?? []).filter(term => term.canonical.toLowerCase() !== pair.canonical.toLowerCase());
            userTerms.push(merged);
            const result = this.saveLocalSenseVoiceTerms(validateSenseVoiceTerms(userTerms), config.enabled);
            return { ...result, enabled: config.enabled && merged.enabled };
        } catch (error) { return { success: false, error: error instanceof Error ? error.message : '词对保存失败。' }; }
    }

    public getSpeakerSeparationMode(): 'auto' | 'off' {
        return this.settings.speakerSeparationMode === 'off' ? 'off' : 'auto';
    }

    public setSpeakerSeparationMode(mode: 'auto' | 'off'): void {
        if (!['auto', 'off'].includes(mode)) {
            throw new Error(`[SettingsManager] Invalid speakerSeparationMode: ${mode}`);
        }
        this.settings.speakerSeparationMode = mode;
        this.saveSettings();
    }

    private speakerVerificationGeneration = 0;

    public getSpeakerVerificationGeneration(): number { return this.speakerVerificationGeneration; }

    public getSpeakerVerificationMode(): 'off' | 'local' {
        return this.settings.speakerVerificationMode === 'local' ? 'local' : 'off';
    }

    public setSpeakerVerificationMode(mode: 'off' | 'local'): void {
        if (!['off', 'local'].includes(mode)) {
            throw new Error(`[SettingsManager] Invalid speakerVerificationMode: ${mode}`);
        }
        this.speakerVerificationGeneration++;
        this.settings.speakerVerificationMode = mode;
        this.saveSettings();
    }

    private loadSettings(): void {
        try {
            if (fs.existsSync(this.settingsPath)) {
                const data = fs.readFileSync(this.settingsPath, 'utf8');
                try {
                    const parsed = JSON.parse(data);
                    // Minimal validation to ensure it's an object before assigning
                    if (typeof parsed === 'object' && parsed !== null) {
                        this.settings = parsed;
                        this.migrateLegacySettings();
                        console.log('[SettingsManager] Settings loaded successfully', { keys: Object.keys(this.settings).length });
                    } else {
                        throw new Error('Settings JSON is not a valid object');
                    }
                } catch (parseError) {
                    console.error('[SettingsManager] Failed to parse settings.json. Continuing with empty settings. Error:', parseError);
                    this.settings = {};
                }
                console.log('[SettingsManager] Settings loaded');
            }
        } catch (e) {
            console.error('[SettingsManager] Failed to read settings file:', e);
            this.settings = {};
        }
    }

    // Normalize legacy screen-understanding mode values written by older builds.
    // Runs once on load; rewrites settings.json if any migration was applied.
    private migrateLegacySettings(): void {
        const raw = this.settings.screenUnderstandingMode as unknown as string | undefined;
        if (!raw) return;
        if ((VALID_SCREEN_UNDERSTANDING_MODES as readonly string[]).includes(raw)) return;
        const migrated = LEGACY_SCREEN_MODE_MIGRATION[raw];
        if (migrated) {
            console.warn(`[SettingsManager] Migrating legacy screenUnderstandingMode "${raw}" → "${migrated}" (OCR runtime path removed)`);
            this.settings.screenUnderstandingMode = migrated;
            this.saveSettings();
        } else {
            console.warn(`[SettingsManager] Unknown legacy screenUnderstandingMode "${raw}" — defaulting to vision_first`);
            this.settings.screenUnderstandingMode = 'vision_first';
            this.saveSettings();
        }

        // Migrate legacy default local STT model from Moonshine to Whisper Base.
        // Moonshine is English-only; Whisper Base supports multilingual use cases.
        const migrateModel = (key: keyof AppSettings) => {
            const val = (this.settings as Record<string, unknown>)[key] as string | undefined;
            if (val && val.startsWith('onnx-community/moonshine-')) {
                console.warn(`[SettingsManager] Migrating legacy ${key} "${val}" → "Xenova/whisper-base"`);
                (this.settings as Record<string, unknown>)[key] = 'Xenova/whisper-base';
                this.saveSettings();
            }
        };
        migrateModel('localWhisperModel');
        migrateModel('localWhisperModelMic');
        migrateModel('localWhisperModelSystem');
    }

    private saveSettings(): void {
        try {
            const tmpPath = this.settingsPath + '.tmp';
            fs.writeFileSync(tmpPath, JSON.stringify(this.settings, null, 2));
            fs.renameSync(tmpPath, this.settingsPath);
        } catch (e) {
            console.error('[SettingsManager] Failed to save settings:', e);
            throw e;
        }
    }
}
