import { CredentialsManager } from '../services/CredentialsManager';
import { SettingsManager } from '../services/SettingsManager';
import type { AppAPIConfig } from './EmbeddingProviderResolver';

export function buildEmbeddingRuntimeConfig(): AppAPIConfig {
  const credentials = CredentialsManager.getInstance();
  return {
    qcloudKey: credentials.getNativelyApiKey()
      || process.env.NATIVE_API_KEY
      || undefined,
    doubaoKey: credentials.getDoubaoLlmApiKey()
      || process.env.DOUBAO_API_KEY
      || process.env.ARK_API_KEY
      || undefined,
    doubaoEmbeddingModel: credentials.getDoubaoEmbeddingModel()
      || process.env.DOUBAO_EMBEDDING_MODEL
      || undefined,
    openaiKey: credentials.getOpenaiApiKey()
      || process.env.OPENAI_API_KEY
      || undefined,
    geminiKey: credentials.getGeminiApiKey()
      || process.env.GOOGLE_API_KEY
      || process.env.GEMINI_API_KEY
      || undefined,
    ollamaUrl: process.env.OLLAMA_URL || 'http://localhost:11434',
    providerDataScopes: SettingsManager.getInstance().get('providerDataScopes'),
  };
}
