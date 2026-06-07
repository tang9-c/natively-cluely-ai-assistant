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

import { BaseSTT } from './BaseSTT';
import { GoogleSTT } from './GoogleSTT';
import { RestSTT, type RestSttProvider } from './RestSTT';
import { DeepgramStreamingSTT } from './DeepgramStreamingSTT';
import { SonioxStreamingSTT } from './SonioxStreamingSTT';
import { ElevenLabsStreamingSTT } from './ElevenLabsStreamingSTT';
import { OpenAIStreamingSTT } from './OpenAIStreamingSTT';
import { NativelyProSTT } from './NativelyProSTT';
import { CredentialsManager } from '../services/CredentialsManager';
import { SettingsManager } from '../services/SettingsManager';

type SttProviderId =
  | 'none'
  | 'google'
  | 'natively'
  | 'deepgram'
  | 'soniox'
  | 'elevenlabs'
  | 'openai'
  | 'groq'
  | 'azure'
  | 'ibmwatson'
  | 'doubao'
  | 'doubao-auc'
  | 'local-whisper';

interface RegistryEntry {
  /** Human-readable name for logs */
  name: string;
  /** CredentialsManager getter that returns the required API key (undefined if no key needed) */
  needsKey?: keyof CredentialsManager;
  /** Factory: creates the STT instance. Receives (key, speaker, extraConfig?). */
  factory: (key: string, speaker: 'interviewer' | 'user', extra?: Record<string, string | undefined>) => BaseSTT;
  /** Optional extra config pulled from CredentialsManager before factory is called */
  extraConfig?: (cm: CredentialsManager) => Record<string, string | undefined>;
}

export const STT_REGISTRY: Record<SttProviderId, RegistryEntry | undefined> = {
  none: {
    name: 'None',
    factory: () => new GoogleSTT('fallback'), // never used — createSTTProvider returns null early
  },

  google: {
    name: 'GoogleSTT',
    factory: (_key, speaker) => new GoogleSTT(speaker),
  },

  natively: {
    name: 'NativelyProSTT',
    needsKey: 'getNativelyApiKey',
    factory: (key, speaker) =>
      new NativelyProSTT(key, speaker === 'interviewer' ? 'system' : 'mic'),
  },

  deepgram: {
    name: 'DeepgramStreamingSTT',
    needsKey: 'getDeepgramApiKey',
    factory: (key) => new DeepgramStreamingSTT(key),
  },

  soniox: {
    name: 'SonioxStreamingSTT',
    needsKey: 'getSonioxApiKey',
    factory: (key) => new SonioxStreamingSTT(key),
  },

  elevenlabs: {
    name: 'ElevenLabsStreamingSTT',
    needsKey: 'getElevenLabsApiKey',
    factory: (key) => new ElevenLabsStreamingSTT(key),
  },

  openai: {
    name: 'OpenAIStreamingSTT',
    needsKey: 'getOpenAiSttApiKey',
    extraConfig: (cm) => ({ baseUrl: cm.getOpenAiSttBaseUrl() }),
    factory: (key, _speaker, extra?: Record<string, string | undefined>) =>
      new OpenAIStreamingSTT(key, extra?.baseUrl),
  },

  groq: {
    name: 'RestSTT (Groq)',
    needsKey: 'getGroqSttApiKey',
    extraConfig: (cm) => ({ modelOverride: cm.getGroqSttModel() }),
    factory: (key, _speaker, extra?: Record<string, string | undefined>) =>
      new RestSTT('groq', key, extra?.modelOverride),
  },

  azure: {
    name: 'RestSTT (Azure)',
    needsKey: 'getAzureApiKey',
    extraConfig: (cm) => ({ region: cm.getAzureRegion() }),
    factory: (key, _speaker, extra?: Record<string, string | undefined>) =>
      new RestSTT('azure', key, undefined, extra?.region),
  },

  ibmwatson: {
    name: 'RestSTT (IBM Watson)',
    needsKey: 'getIbmWatsonApiKey',
    extraConfig: (cm) => ({ region: cm.getIbmWatsonRegion() }),
    factory: (key, _speaker, extra?: Record<string, string | undefined>) =>
      new RestSTT('ibmwatson', key, undefined, extra?.region),
  },

  doubao: {
    name: 'RestSTT (Doubao)',
    needsKey: 'getDoubaoApiKey',
    factory: (key) => new RestSTT('doubao', key),
  },

  'doubao-auc': {
    name: 'RestSTT (Doubao AUC)',
    needsKey: 'getDoubaoApiKey',
    factory: (key) => new RestSTT('doubao-auc', key),
  },

  'local-whisper': {
    name: 'LocalWhisperSTT',
    factory: (_key, speaker) => {
      const sm = SettingsManager.getInstance();
      const globalModel = sm.get('localWhisperModel') ?? 'onnx-community/moonshine-tiny-ONNX';
      let modelId = globalModel;
      if (sm.get('localWhisperPerChannelEnabled')) {
        const override =
          speaker === 'interviewer'
            ? sm.get('localWhisperModelSystem')
            : sm.get('localWhisperModelMic');
        if (override) modelId = override;
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
export function createSTTProvider(
  providerId: SttProviderId,
  speaker: 'interviewer' | 'user'
): BaseSTT | null {
  if (providerId === 'none') {
    return null;
  }

  const entry = STT_REGISTRY[providerId];
  if (!entry) {
    console.warn(`[STTRegistry] Unknown provider "${providerId}" — falling back to GoogleSTT`);
    return new GoogleSTT(speaker);
  }

  // Providers that don't need a key
  if (!entry.needsKey) {
    return entry.factory('', speaker);
  }

  const cm = CredentialsManager.getInstance();
  const key = (cm[entry.needsKey] as () => string | undefined)();

  if (!key) {
    console.warn(`[STTRegistry] No API key for ${entry.name}, falling back to GoogleSTT`);
    return new GoogleSTT(speaker);
  }

  const extra = entry.extraConfig ? entry.extraConfig(cm) : undefined;
  return entry.factory(key, speaker, extra);
}
