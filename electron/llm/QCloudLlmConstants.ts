export const QCLOUD_LLM_BASE_URL = "https://rlbucefe.sealosbja.site";
export const QCLOUD_CHAT_MODEL = "lite32k";
export const QCLOUD_MODELS_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/models`;
export const QCLOUD_CHAT_COMPLETIONS_ENDPOINT = `${QCLOUD_LLM_BASE_URL}/v1/chat/completions`;

// The OpenAI SDK appends resource paths such as /chat/completions.
export const QCLOUD_OPENAI_SDK_BASE_URL = `${QCLOUD_LLM_BASE_URL}/v1`;
