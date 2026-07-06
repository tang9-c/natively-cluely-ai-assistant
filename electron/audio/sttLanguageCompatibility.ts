export type SttLanguageCompatibilityReasonCode =
  | 'AUTO_NORMALIZED_TO_ENGLISH'
  | 'MODEL_ENGLISH_ONLY'
  | 'PROVIDER_LANGUAGE_UNSUPPORTED'
  | 'SUPPORTED';

export type SttProviderId =
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
  | 'qcloud-stt'
  | 'local-whisper'
  | 'local-sensevoice';

export interface LocalWhisperChannelConfig {
  enabled: boolean;
  micModelId: string;
  systemModelId: string;
  globalModelId: string;
}

export interface SttLanguageCompatibilityInput {
  provider: string;
  requestedLanguageKey: string;
  localWhisper?: Partial<LocalWhisperChannelConfig>;
}

export interface SttLanguageCompatibilityResult {
  requestedLanguageKey: string;
  effectiveLanguageKey: string;
  willHonorSelection: boolean;
  reasonCode: SttLanguageCompatibilityReasonCode;
  message: string;
}

const DEFAULT_LOCAL_WHISPER_MODEL = 'Xenova/whisper-base';

const ENGLISH_ONLY_LOCAL_WHISPER_MODELS = new Set([
  'onnx-community/moonshine-tiny-ONNX',
  'onnx-community/moonshine-base-ONNX',
  'distil-whisper/distil-small.en',
  'distil-whisper/distil-medium.en',
  'distil-whisper/distil-large-v2',
  'distil-whisper/distil-large-v3',
  'Xenova/whisper-tiny.en',
  'Xenova/whisper-base.en',
  'Xenova/whisper-small.en',
  'Xenova/whisper-medium.en',
]);

const EXPLICIT_LANGUAGE_PROVIDERS = new Set<SttProviderId>([
  'google',
  'natively',
  'deepgram',
  'soniox',
  'elevenlabs',
  'openai',
  'groq',
  'azure',
  'ibmwatson',
  'doubao',
  'doubao-auc',
  'local-whisper',
  'local-sensevoice',
]);

const SENSEVOICE_SUPPORTED_LANGUAGE_KEYS = new Set([
  'chinese',
  'english-us',
  'english-uk',
  'english-in',
  'english-au',
  'english-ca',
  'japanese',
  'korean',
]);

export function normalizeRecognitionLanguageForProvider(provider: string, languageKey: string): string {
  if (languageKey !== 'auto') return languageKey;
  if (provider === 'local-sensevoice' || provider === 'qcloud-stt') return 'chinese';
  return provider !== 'natively' ? 'english-us' : languageKey;
}

function coerceLocalWhisperConfig(
  cfg?: Partial<LocalWhisperChannelConfig>,
): Required<LocalWhisperChannelConfig> {
  return {
    enabled: !!cfg?.enabled,
    globalModelId: cfg?.globalModelId || DEFAULT_LOCAL_WHISPER_MODEL,
    micModelId: cfg?.micModelId || '',
    systemModelId: cfg?.systemModelId || '',
  };
}

function describeLocalWhisperModelScope(
  cfg: Required<LocalWhisperChannelConfig>,
): Array<{ scope: 'global' | 'mic' | 'system'; modelId: string }> {
  if (cfg.enabled) {
    return [
      { scope: 'mic', modelId: cfg.micModelId || cfg.globalModelId || DEFAULT_LOCAL_WHISPER_MODEL },
      { scope: 'system', modelId: cfg.systemModelId || cfg.globalModelId || DEFAULT_LOCAL_WHISPER_MODEL },
    ];
  }

  return [{ scope: 'global', modelId: cfg.globalModelId || DEFAULT_LOCAL_WHISPER_MODEL }];
}

function formatModelScopeLabel(scope: 'global' | 'mic' | 'system'): string {
  if (scope === 'mic') return '麦克风';
  if (scope === 'system') return '系统音频';
  return '当前模型';
}

export function resolveSttLanguageCompatibility(
  input: SttLanguageCompatibilityInput,
): SttLanguageCompatibilityResult {
  const provider = (input.provider || 'none') as SttProviderId;
  const requestedLanguageKey = input.requestedLanguageKey || 'english-us';
  const effectiveLanguageKey = normalizeRecognitionLanguageForProvider(provider, requestedLanguageKey);

  if (provider === 'qcloud-stt' && requestedLanguageKey === 'auto') {
    return {
      requestedLanguageKey,
      effectiveLanguageKey,
      willHonorSelection: true,
      reasonCode: 'SUPPORTED',
      message: 'QCLOUD API 语音通道会按中文优先策略执行自动识别。',
    };
  }

  if (provider === 'qcloud-stt' && requestedLanguageKey === 'chinese') {
    return {
      requestedLanguageKey,
      effectiveLanguageKey: 'chinese',
      willHonorSelection: true,
      reasonCode: 'SUPPORTED',
      message: 'QCLOUD API 语音通道会按中文优先策略执行识别。',
    };
  }

  if (requestedLanguageKey === 'auto' && effectiveLanguageKey !== 'auto') {
    return {
      requestedLanguageKey,
      effectiveLanguageKey,
      willHonorSelection: false,
      reasonCode: 'AUTO_NORMALIZED_TO_ENGLISH',
      message:
        '当前语音提供商不会按自动检测执行识别，而是会回退到英文。会议仍可继续，但这次识别不会按所选语言执行。',
    };
  }

  if (requestedLanguageKey === 'chinese' && provider === 'local-whisper') {
    const cfg = coerceLocalWhisperConfig(input.localWhisper);
    const unsupportedScopes = describeLocalWhisperModelScope(cfg).filter(({ modelId }) =>
      ENGLISH_ONLY_LOCAL_WHISPER_MODELS.has(modelId),
    );

    if (unsupportedScopes.length > 0) {
      const details = unsupportedScopes
        .map(({ scope, modelId }) => `${formatModelScopeLabel(scope)}使用 ${modelId}`)
        .join('，');
      return {
        requestedLanguageKey,
        effectiveLanguageKey: 'english-us',
        willHonorSelection: false,
        reasonCode: 'MODEL_ENGLISH_ONLY',
        message: `当前本地 Whisper 模型仅支持英文，Chinese 设置不会生效：${details}。会议仍可继续，但这次中文识别不会按所选语言执行。`,
      };
    }
  }

  if (
    requestedLanguageKey !== 'auto' &&
    provider === 'local-sensevoice' &&
    !SENSEVOICE_SUPPORTED_LANGUAGE_KEYS.has(requestedLanguageKey)
  ) {
    return {
      requestedLanguageKey,
      effectiveLanguageKey: 'chinese',
      willHonorSelection: false,
      reasonCode: 'PROVIDER_LANGUAGE_UNSUPPORTED',
      message: 'Local SenseVoice 当前主要支持中文、英文、日语和韩语；该语言会回退到中文优先识别。',
    };
  }

  if (requestedLanguageKey !== 'auto' && !EXPLICIT_LANGUAGE_PROVIDERS.has(provider)) {
    return {
      requestedLanguageKey,
      effectiveLanguageKey,
      willHonorSelection: false,
      reasonCode: 'PROVIDER_LANGUAGE_UNSUPPORTED',
      message: '当前未启用支持该语言设置的语音提供商。会议仍可继续，但这次识别不会按所选语言执行。',
    };
  }

  return {
    requestedLanguageKey,
    effectiveLanguageKey,
    willHonorSelection: true,
    reasonCode: 'SUPPORTED',
    message: '当前语音提供商会按所选语言执行识别。',
  };
}
