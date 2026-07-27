export const QCLOUD_LLM_BASE_URL = "https://obzbovrjewzd.sealosbja.site";
export const QCLOUD_CHAT_MODEL = "lite32k";
export const QCLOUD_SKILL_CHAT_MODEL = "lite32k";
export const QCLOUD_MEETING_SUMMARY_MODEL = "lite32k";
export const QCLOUD_SKILL_CHAT_TIMEOUT_MS = 60_000;
export const QCLOUD_MEETING_SUMMARY_TIMEOUT_MS = 60_000;
export const QCLOUD_DEFAULT_OUTPUT_TOKENS = 8_192;
export const QCLOUD_PPTX_ENHANCE_OUTPUT_TOKENS = 2_048;
export const QCLOUD_MEETING_SUMMARY_OUTPUT_TOKENS = 12_000;
export const QCLOUD_TRANSCRIPT_SKILL_OUTPUT_TOKENS = 16_000;
export const QCLOUD_CHAT_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/chat`;
export const QCLOUD_MODELS_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/models`;
export const QCLOUD_CHAT_COMPLETIONS_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/chat/completions`;
export const QCLOUD_EMBEDDINGS_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/embeddings`;
export const QCLOUD_EMBEDDING_MODEL = "embedding-vision";
export const QCLOUD_EMBEDDING_BACKING_MODEL = "doubao-embedding-vision-251215";
export const QCLOUD_STT_SUBMIT_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/doubao/audio/auc/submit`;
export const QCLOUD_STT_QUERY_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/doubao/audio/auc/query`;

// The OpenAI SDK appends resource paths such as /chat/completions.
export const QCLOUD_OPENAI_SDK_BASE_URL = `${QCLOUD_LLM_BASE_URL}/v1`;

export interface QCloudModelSpec {
  maxInputTokens: number;
  maxOutputTokens: number;
  maxContextTokens: number;
}

export const QCLOUD_MODEL_SPECS: Record<string, QCloudModelSpec> = {
  pro32k: {
    maxInputTokens: 224_000,
    maxOutputTokens: 128_000,
    maxContextTokens: 256_000,
  },
  lite32k: {
    maxInputTokens: 224_000,
    maxOutputTokens: 128_000,
    maxContextTokens: 256_000,
  },
  turbo: {
    maxInputTokens: 224_000,
    maxOutputTokens: 128_000,
    maxContextTokens: 256_000,
  },
};

export function getQCloudModelSpec(model: string = QCLOUD_CHAT_MODEL): QCloudModelSpec {
  return QCLOUD_MODEL_SPECS[model] ?? QCLOUD_MODEL_SPECS[QCLOUD_CHAT_MODEL];
}
