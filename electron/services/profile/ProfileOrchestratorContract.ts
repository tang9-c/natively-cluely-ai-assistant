import type { ProviderDataScope } from '../../llm/ProviderRouter';

export type GenerateContentFn = (contents: unknown[]) => Promise<unknown>;
export type EmbedFn = (text: string) => Promise<number[]>;

export interface KnowledgeResult {
  isIntroQuestion?: boolean;
  introResponse?: string;
  liveNegotiationResponse?: unknown;
  systemPromptInjection?: string;
  contextBlock?: string;
  dataScopes?: ProviderDataScope[];
}

export interface ProfileOrchestratorRuntime {
  setLLMHelper(llmHelper: unknown): void;
  setKnowledgeMode(enabled: boolean): void;
  isKnowledgeMode(): boolean;
  processQuestion(message: string): Promise<KnowledgeResult | null>;
  feedForDepthScoring(message: string): void;
  feedInterviewerUtterance(message: string): void;
  setGenerateContentFn(fn: GenerateContentFn): void;
  setLiveCoachingContentFn(fn: GenerateContentFn): void;
  setEmbedFn(fn: EmbedFn): void;
  setEmbedQueryFn(fn: EmbedFn): void;
  setCustomNotes(content: string): void;
  getCustomNotes(): string;
}
