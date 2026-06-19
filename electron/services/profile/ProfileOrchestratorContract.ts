import type { ProviderDataScope } from '../../llm/ProviderRouter';

// Task 6: removed two type aliases and four setters from
// ProfileOrchestrator. They were dead injection surfaces — main.ts set them,
// the orchestrator stored the references, nothing read them. The runtime
// contract below intentionally lists only the methods that are actually
// invoked from LLMHelper.

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
  setCustomNotes(content: string): void;
  getCustomNotes(): string;
}
