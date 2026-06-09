"use strict";
/**
 * STT Provider Registry
 *
 * Replaces the 115-line if/else factory chain in main.ts with a declarative
 * table. Adding a new provider is now a single-file change.
 *
 * Each entry defines:
 *   - needsKey: which CredentialsManager getter returns the required API key
 *   - factory:  creates the STT instance given the key + speaker context
 *   - fallback: provider to use when the key is missing (defaults to GoogleSTT)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.STT_REGISTRY = void 0;
exports.createSTTProvider = createSTTProvider;
const GoogleSTT_1 = require("./GoogleSTT");
const RestSTT_1 = require("./RestSTT");
const DeepgramStreamingSTT_1 = require("./DeepgramStreamingSTT");
const SonioxStreamingSTT_1 = require("./SonioxStreamingSTT");
const ElevenLabsStreamingSTT_1 = require("./ElevenLabsStreamingSTT");
const OpenAIStreamingSTT_1 = require("./OpenAIStreamingSTT");
const NativelyProSTT_1 = require("./NativelyProSTT");
const CredentialsManager_1 = require("../services/CredentialsManager");
const SettingsManager_1 = require("../services/SettingsManager");
exports.STT_REGISTRY = {
    none: {
        name: 'None',
        factory: () => new GoogleSTT_1.GoogleSTT('fallback'), // never used — createSTTProvider returns null early
    },
    google: {
        name: 'GoogleSTT',
        factory: (_key, speaker) => new GoogleSTT_1.GoogleSTT(speaker),
    },
    natively: {
        name: 'NativelyProSTT',
        needsKey: 'getNativelyApiKey',
        factory: (key, speaker) => new NativelyProSTT_1.NativelyProSTT(key, speaker === 'interviewer' ? 'system' : 'mic'),
    },
    deepgram: {
        name: 'DeepgramStreamingSTT',
        needsKey: 'getDeepgramApiKey',
        factory: (key) => new DeepgramStreamingSTT_1.DeepgramStreamingSTT(key),
    },
    soniox: {
        name: 'SonioxStreamingSTT',
        needsKey: 'getSonioxApiKey',
        factory: (key) => new SonioxStreamingSTT_1.SonioxStreamingSTT(key),
    },
    elevenlabs: {
        name: 'ElevenLabsStreamingSTT',
        needsKey: 'getElevenLabsApiKey',
        factory: (key) => new ElevenLabsStreamingSTT_1.ElevenLabsStreamingSTT(key),
    },
    openai: {
        name: 'OpenAIStreamingSTT',
        needsKey: 'getOpenAiSttApiKey',
        extraConfig: (cm) => ({ baseUrl: cm.getOpenAiSttBaseUrl() }),
        factory: (key, _speaker, extra) => new OpenAIStreamingSTT_1.OpenAIStreamingSTT(key, extra?.baseUrl),
    },
    groq: {
        name: 'RestSTT (Groq)',
        needsKey: 'getGroqSttApiKey',
        extraConfig: (cm) => ({ modelOverride: cm.getGroqSttModel() }),
        factory: (key, _speaker, extra) => new RestSTT_1.RestSTT('groq', key, extra?.modelOverride),
    },
    azure: {
        name: 'RestSTT (Azure)',
        needsKey: 'getAzureApiKey',
        extraConfig: (cm) => ({ region: cm.getAzureRegion() }),
        factory: (key, _speaker, extra) => new RestSTT_1.RestSTT('azure', key, undefined, extra?.region),
    },
    ibmwatson: {
        name: 'RestSTT (IBM Watson)',
        needsKey: 'getIbmWatsonApiKey',
        extraConfig: (cm) => ({ region: cm.getIbmWatsonRegion() }),
        factory: (key, _speaker, extra) => new RestSTT_1.RestSTT('ibmwatson', key, undefined, extra?.region),
    },
    doubao: {
        name: 'RestSTT (Doubao)',
        needsKey: 'getDoubaoApiKey',
        factory: (key) => new RestSTT_1.RestSTT('doubao', key),
    },
    'doubao-auc': {
        name: 'RestSTT (Doubao AUC)',
        needsKey: 'getDoubaoApiKey',
        factory: (key) => new RestSTT_1.RestSTT('doubao-auc', key),
    },
    'local-whisper': {
        name: 'LocalWhisperSTT',
        factory: (_key, speaker) => {
            const sm = SettingsManager_1.SettingsManager.getInstance();
            const globalModel = sm.get('localWhisperModel') ?? 'Xenova/whisper-base';
            let modelId = globalModel;
            if (sm.get('localWhisperPerChannelEnabled')) {
                const override = speaker === 'interviewer'
                    ? sm.get('localWhisperModelSystem')
                    : sm.get('localWhisperModelMic');
                if (override)
                    modelId = override;
            }
            const { LocalWhisperSTT } = require('./LocalWhisperSTT');
            const lws = new LocalWhisperSTT(modelId);
            lws.setChannel(speaker === 'interviewer' ? 'system' : 'mic');
            return lws;
        },
    },
};
/**
 * Create an STT provider instance for the given speaker.
 * Falls back to GoogleSTT when the configured provider's API key is missing.
 */
function createSTTProvider(providerId, speaker) {
    if (providerId === 'none') {
        return null;
    }
    const entry = exports.STT_REGISTRY[providerId];
    if (!entry) {
        console.warn(`[STTRegistry] Unknown provider "${providerId}" — falling back to GoogleSTT`);
        return new GoogleSTT_1.GoogleSTT(speaker);
    }
    // Providers that don't need a key
    if (!entry.needsKey) {
        return entry.factory('', speaker);
    }
    const cm = CredentialsManager_1.CredentialsManager.getInstance();
    const key = cm[entry.needsKey]();
    if (!key) {
        console.warn(`[STTRegistry] No API key for ${entry.name}, falling back to GoogleSTT`);
        return new GoogleSTT_1.GoogleSTT(speaker);
    }
    const extra = entry.extraConfig ? entry.extraConfig(cm) : undefined;
    return entry.factory(key, speaker, extra);
}
//# sourceMappingURL=sttRegistry.js.map