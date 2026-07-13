import type { TranscriptEmotion, TranscriptEmotionSource } from '../../shared/senseVoiceEmotion'
export type { TranscriptEmotion, TranscriptEmotionSource } from '../../shared/senseVoiceEmotion'
import type { ContextNeedDecision } from '../../shared/contextNeedDecision'
export type {
  ContextNeedDecision,
  ContextNeedDecisionSource,
  ContextNeedLevel,
} from '../../shared/contextNeedDecision'

// Phase 3 — DynamicActionPayload mirrors electron/services/dynamic-actions/DynamicAction.ts.
// Kept as a structural interface (not a class import) to preserve the strict main↔renderer
// type boundary — the renderer never imports from electron/* directly.
export interface DynamicActionEvidenceRef {
  source: 'transcript' | 'screen' | 'reference' | 'meeting_history'
  text: string
  timestamp?: number
  speaker?: string
  fileId?: string
  chunkId?: string
}

export interface DynamicActionSemanticGate {
  decision: 'pass' | 'reject' | 'defer' | 'fast_path'
  actionType: string
  semanticIntent?: string
  confidence: number
  reasons: string[]
  regexCandidates: string[]
  rejectedCandidates: string[]
  usedLocalIntentModel: boolean
  usedCloudArbitration: boolean
  semanticProvider: 'local_intent' | 'cloud_llm' | 'rule_fast_path' | 'unavailable'
  arbitrationStatus: 'cloud_used' | 'local_only_by_privacy' | 'local_fallback_cloud_unavailable' | 'cloud_unavailable' | 'local_only_not_needed'
  degradedReason?: string
  upgradedByRepeatedEvidence: boolean
}

export type DynamicActionOutputType =
  | 'spoken_response'
  | 'checklist'
  | 'email_draft'
  | 'action_item'
  | 'decision_record'

export type DynamicActionRiskState =
  | 'auto_countdown'
  | 'normal'

export interface DynamicActionProductContract {
  userAction: string
  whyNow: string
  evidenceSummary?: string
  outputType: DynamicActionOutputType
  outputPromise: string
  riskState: DynamicActionRiskState
  contextNeedDecision?: ContextNeedDecision
}

export interface DynamicActionPayload {
  id: string
  parentActionId?: string
  sessionId: string
  modeId: string
  modeTemplateType: string
  type: string
  label: string
  description?: string
  productContract: DynamicActionProductContract
  confidence: number
  priority: number
  evidenceRefs: DynamicActionEvidenceRef[]
  status: 'candidate' | 'shown' | 'accepted' | 'auto_generated' | 'dismissed' | 'expired' | 'generated_failed' | 'completed'
  createdAt: number
  expiresAt?: number
  promptInstruction: string
  sourceIntent?: string
  latestTurn?: string
  language?: string
  emotion?: string
  emotionSource?: TranscriptEmotionSource
  keyEntities?: string[]
  retrievalQuery?: string
  autoSurfacePolicy?: 'auto' | 'card' | 'silent'
  autoTriggerEligible?: boolean
  autoTriggerReason?: string
  signalStatus?: 'candidate' | 'confirmed' | 'cooling_down' | 'expired'
  evidenceCount?: number
  confirmationSource?: 'trigger' | 'cloud_intent' | 'local_intent' | 'heuristic' | 'continuation_planner'
  confirmedIntent?: string
  semanticGate?: DynamicActionSemanticGate
  answerStyle?: {
    maxWords: number
    format: 'bullets' | 'short_script' | 'code' | 'checklist' | 'summary' | 'email'
    tone: string
  }
}

type MeetingStartStatus = {
  phase: 'starting' | 'ready' | 'failed';
  message?: string;
}

export interface DynamicActionModeEvent {
  actionId?: string
  parentActionId?: string
  actionType?: string
  sourceIntent?: string
  modeTemplateType?: string
  intent?: string
  confidence?: number
  latestTurn?: string
  emotion?: string
  emotionSource?: TranscriptEmotionSource
  language?: string
  keyEntities?: string[]
  retrievalQuery?: string
  autoSurfacePolicy?: string
  promptInstruction?: string
  productContract?: {
    outputType: DynamicActionOutputType
    contextNeedDecision?: ContextNeedDecision
  }
  answerShape?: string
}

export interface ModeIntentKeywordSetting {
  intent: string
  keywordsCsv: string
}

export type AnswerQualityEventType = 'shown' | 'copied' | 'accepted' | 'ignored' | 'regenerated'

export type AnswerDegradedReason =
  | 'transcript_truncated'
  | 'assistant_history_truncated'
  | 'assistant_history_dropped'
  | 'meeting_history_truncated'
  | 'meeting_history_dropped'
  | 'uploaded_material_context_truncated'
  | 'uploaded_material_context_dropped'
  | 'uploaded_material_rag_failed'
  | 'no_relevant_uploaded_material'
  | 'business_system_context_dropped'
  | 'business_system_not_configured'
  | 'business_system_unavailable'
  | 'business_system_error'
  | 'business_system_auth_failed'
  | 'business_system_timeout'
  | 'business_system_no_result'
  | 'business_system_ambiguous'
  | 'business_system_missing_query_anchor'
  | 'business_system_unsupported_operation'
  | 'screen_context_failed'
  | 'screen_context_scope_blocked'
  | 'screen_context_no_vision_provider'
  | 'screen_context_truncated'
  | 'screen_context_dropped'
  | 'mode_context_truncated'
  | 'mode_context_dropped'
  | 'rag_unavailable'
  | 'embedding_unavailable'
  | 'speaker_separation_unavailable'
  | 'speaker_metadata_low_confidence'
  | 'speaker_metadata_unavailable'
  | 'stt_user_failed'
  | 'stt_interviewer_failed'
  | 'context_scope_denied'

export interface AnswerContextUsed {
  currentTranscript: boolean
  shortTermHistory: boolean
  uploadedDocumentRag: boolean
  historicalMeetings: boolean
  longTermMemory: boolean
  enterpriseKnowledge: boolean
  businessSystemContext: boolean
  screenContext: boolean
}

export interface AnswerSourceStatus {
  ragAttempted: boolean
  ragReady: boolean
  embeddingReady: boolean
  uploadedMaterialHitCount: number
  citationCount: number
  screenContextStatus: 'not_available' | 'available' | 'failed'
  businessSystemStatus?: 'not_requested' | 'available' | 'not_configured' | 'missing_query_anchor' | 'auth_failed' | 'timeout' | 'no_result' | 'ambiguous' | 'unsupported_operation' | 'unavailable' | 'error'
  businessSystemSourceName?: string
  sttUserStatus?: 'connected' | 'reconnecting' | 'failed'
  sttInterviewerStatus?: 'connected' | 'reconnecting' | 'failed'
  speakerSeparationStatus?: 'off' | 'on' | 'unavailable'
}

export interface AnswerCitation {
  citationId?: string
  sourceType: 'current_meeting' | 'historical_meeting' | 'uploaded_material' | 'long_term_memory' | 'enterprise_knowledge' | 'screen_context'
  sourceId: string
  sourceVersion?: string
  chunkId?: string | number | null
  chunkContentHash?: string
  sourceFileHash?: string | null
  startOffset?: number | null
  endOffset?: number | null
  score?: number | null
  title?: string | null
  timestamp?: number | string | null
}

export interface AnswerContextTrace {
  answer_id?: string
  answerId?: string
  contextUsed: AnswerContextUsed
  sourceStatus: AnswerSourceStatus
  citations: AnswerCitation[]
  degraded_reason?: string | null
  degradedReason?: string | null
  status?: string
  provider?: string | null
  model?: string | null
  latency_ms?: number | null
  latencyMs?: number | null
  observability?: Record<string, unknown>
}

export interface ChatContextStatusPayload {
  degradedReason?: string
  sourceStatus?: AnswerSourceStatus
  uploadedMaterialHitCount: number
  citationCount: number
}

export interface AnswerQualityEventMetadata {
  surface?: 'overlay' | 'launcher' | 'dynamic_action' | string
  answerAgeMs?: number
  triggerSource?: string
  modeTemplate?: string
  hadCitations?: boolean
}

export interface AnswerQualityMetrics {
  shownCount: number
  copiedCount: number
  acceptedCount: number
  ignoredCount: number
  regeneratedCount: number
  averageLatencyMs: number | null
  p95LatencyMs: number | null
  citationHitRate: number
  userAcceptanceRate: number
  regenerationRate: number
  ragHitRate: number
  noContextAnswerRate: number
}

export interface RealtimeDiagnosticsSummary {
  source: 'persisted'
  sampleSize: number
  traceSampleSize: number
  eventSampleSize: number
  insufficientData: boolean
  metrics: AnswerQualityMetrics
  degradedReasons: Record<string, number>
  sourceStatusCounts: Record<string, number>
  messages: string[]
}

export interface KnowledgeMaterial {
  id: string
  file_name?: string
  fileName?: string
  title?: string
  mime_or_ext?: string
  status: 'queued' | 'indexing' | 'complete' | 'failed' | 'deleted'
  error_code?: string | null
  errorCode?: string | null
  error_message?: string | null
  errorMessage?: string | null
  created_at?: string
  updated_at?: string
}

export interface ContextHealth {
  ragReady: boolean
  embeddingReady: boolean
  ragQueue: { pending: number; processing: number; completed: number; failed: number }
  materialCount: number
  materialQueue: { pending: number; processing: number; completed: number; failed: number }
}

export type ResearchProgressStage =
  | 'cache-check'
  | 'searching'
  | 'synthesizing'
  | 'done'
  | 'error'

export interface ResearchProgressPayload {
  requestId?: string
  stage: ResearchProgressStage
  message: string
}

export interface NativeAudioTranscriptPayload {
  speaker: string
  speakerId?: string
  speakerLabel?: string
  providerSpeakerId?: string
  diarizationProvider?: 'doubao-auc'
  text: string
  timestamp?: number
  final: boolean
  confidence?: number
  startTimestampMs?: number
  endTimestampMs?: number
  emotion?: TranscriptEmotion
  emotionSource?: TranscriptEmotionSource
  speakerVerification?: SpeakerVerificationMetadata
}

export interface SpeakerVerificationMetadata {
  provider: 'local-speaker-verification'
  profileId: 'me'
  isMe: boolean
  confidence: number
  threshold: number
}

export type SpeakerVerificationMode = 'off' | 'local'

export interface SpeakerVerificationStatus {
  enrolled: boolean
  enrolledAt?: number
  model?: string
  mode: SpeakerVerificationMode
}

export interface SpeakerEnrollmentSample {
  samples: number[]
  sampleRate: number
  deviceFingerprint?: string
}

export interface LocalSenseVoiceTermEntry {
  id: string
  canonical: string
  variants: string[]
  enabled: boolean
}

export interface ElectronAPI {
  // @ipc-channel update-content-dimensions
  updateContentDimensions: (dimensions: {
    width: number
    height: number
  }) => Promise<void>
  onToggleExpand: (callback: () => void) => () => void
  // @ipc-channel get-recognition-languages
  getRecognitionLanguages: () => Promise<Record<string, any>>
  // @ipc-channel get-screenshots
  getScreenshots: () => Promise<Array<{ path: string; preview: string }>>
  // @ipc-channel delete-screenshot
  deleteScreenshot: (
    path: string
  ) => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onScreenshotAttached: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onCaptureAndProcess: (
    callback: (data: { path: string; preview: string }) => void
  ) => () => void
  onSolutionsReady: (callback: (solutions: string) => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: any) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: any) => void) => () => void
  onSolutionSuccess: (callback: (data: any) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  // @ipc-channel take-screenshot
  takeScreenshot: () => Promise<{ path: string; preview: string }>
  // @ipc-channel take-selective-screenshot
  takeSelectiveScreenshot: () => Promise<{ path: string; preview: string; cancelled?: boolean }>
  // @ipc-channel move-window-left
  moveWindowLeft: () => Promise<void>
  // @ipc-channel move-window-right
  moveWindowRight: () => Promise<void>
  // @ipc-channel move-window-up
  moveWindowUp: () => Promise<void>
  // @ipc-channel move-window-down
  moveWindowDown: () => Promise<void>
  // @ipc-channel window-minimize
  windowMinimize: () => Promise<void>
  // @ipc-channel window-maximize
  windowMaximize: () => Promise<void>
  // @ipc-channel window-close
  windowClose: () => Promise<void>
  // @ipc-channel window-is-maximized
  windowIsMaximized: () => Promise<boolean>

  // @ipc-channel analyze-image-file
  analyzeImageFile: (path: string) => Promise<void>
  // @ipc-channel quit-app
  quitApp: () => Promise<void>
  // @ipc-channel toggle-window
  toggleWindow: () => Promise<void>
  // @ipc-channel show-window
  showWindow: (inactive?: boolean) => Promise<void>
  // @ipc-channel hide-window
  hideWindow: () => Promise<void>
  // @ipc-channel show-overlay
  showOverlay: () => Promise<void>
  // @ipc-channel hide-overlay
  hideOverlay: () => Promise<void>
  // @ipc-channel get-meeting-active
  getMeetingActive: () => Promise<boolean>
  onMeetingStateChanged: (callback: (data: { isActive: boolean }) => void) => () => void
  onMeetingStartStatus?: (callback: (status: MeetingStartStatus) => void) => () => void
  onMeetingAudioError?: (callback: (message: string) => void) => () => void
  onWindowMaximizedChanged: (callback: (isMaximized: boolean) => void) => () => void
  onEnsureExpanded: (callback: () => void) => () => void
  // @ipc-channel open-external
  openExternal: (url: string) => Promise<void>
  // @ipc-channel set-overlay-mouse-passthrough
  setOverlayMousePassthrough: (enabled: boolean) => Promise<{ success: boolean }>
  // @ipc-channel toggle-overlay-mouse-passthrough
  toggleOverlayMousePassthrough: () => Promise<{ success: boolean; enabled: boolean }>
  // @ipc-channel get-overlay-mouse-passthrough
  getOverlayMousePassthrough: () => Promise<boolean>
  onOverlayMousePassthroughChanged: (callback: (enabled: boolean) => void) => () => void
  // @ipc-channel set-open-at-login
  setOpenAtLogin: (open: boolean) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel get-open-at-login
  getOpenAtLogin: () => Promise<boolean>
  onSettingsVisibilityChange: (callback: (isVisible: boolean) => void) => () => void
  // @ipc-channel toggle-settings-window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>
  // @ipc-channel close-settings-window
  closeSettingsWindow: () => Promise<void>
  toggleAdvancedSettings: () => Promise<void>
  closeAdvancedSettings: () => Promise<void>
  // @ipc-channel settings:open-tab
  openSettingsTab: (tab: string) => Promise<void>
  // @ipc-channel modes:open-manager
  openModesManager: () => Promise<void>
  onOpenSettingsTab: (callback: (tab: string) => void) => () => void
  onOpenModesManager: (callback: () => void) => () => void

  // LLM Model Management
  // @ipc-channel get-current-llm-config
  getCurrentLlmConfig: () => Promise<{ provider: "ollama" | "gemini" | "custom" | "codex-cli" | "doubao"; model: string; isOllama: boolean }>
  // @ipc-channel get-available-ollama-models
  getAvailableOllamaModels: () => Promise<string[]>
  // @ipc-channel switch-to-ollama
  switchToOllama: (model?: string, url?: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel switch-to-gemini
  switchToGemini: (apiKey?: string, modelId?: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel test-llm-connection
  testLlmConnection: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao', apiKey?: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel select-service-account
  selectServiceAccount: () => Promise<{ success: boolean; path?: string; cancelled?: boolean; error?: string }>

  // API Key Management
  setGeminiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setGroqApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setOpenaiApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setClaudeApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-doubao-api-key
  setDoubaoApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-doubao-embedding-model
  setDoubaoEmbeddingModel: (model: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-natively-api-key
  setNativelyApiKey: (apiKey: string, options?: { selectAsDefault?: boolean }) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel get-stored-credentials
  getStoredCredentials: () => Promise<{ hasNativelyKey?: boolean; hasGeminiKey: boolean; hasGroqKey: boolean; hasOpenaiKey: boolean; hasClaudeKey: boolean; hasDoubaoKey?: boolean; hasDoubaoLlmKey?: boolean; geminiKey?: string; groqKey?: string; openaiKey?: string; claudeKey?: string; doubaoKey?: string; googleServiceAccountPath: string | null; sttProvider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'doubao' | 'doubao-auc' | 'qcloud-stt' | 'natively' | 'local-whisper' | 'local-sensevoice'; hasSttGroqKey: boolean; hasSttOpenaiKey: boolean; hasDeepgramKey: boolean; hasElevenLabsKey: boolean; hasAzureKey: boolean; azureRegion: string; hasIbmWatsonKey: boolean; ibmWatsonRegion: string; groqSttModel?: string; hasSonioxKey?: boolean; hasSttDoubaoKey?: boolean; hasDoubaoSttKey?: boolean; hasTavilyKey?: boolean; geminiPreferredModel?: string; groqPreferredModel?: string; openaiPreferredModel?: string; claudePreferredModel?: string; doubaoPreferredModel?: string; doubaoEmbeddingModel?: string; sttGroqKey?: string; sttOpenaiKey?: string; sttDeepgramKey?: string; sttElevenLabsKey?: string; sttAzureKey?: string; sttIbmKey?: string; sttSonioxKey?: string; sttDoubaoKey?: string; openAiSttBaseUrl?: string }>
  // Permissions
  // @ipc-channel permissions:check
  checkPermissions:     () => Promise<{
    microphone: 'granted'|'denied'|'not-determined'|'restricted';
    screen: 'granted'|'denied'|'not-determined'|'restricted';
    platform: string;
    screenHealth: {
      status: 'granted'|'denied'|'not-determined'|'restricted';
      capturable: boolean;
      effectiveGranted: boolean;
      staleGrantSuspected: boolean;
      recommendedFix: 'open-settings' | 'reset-tcc' | 'restart-app' | 'none';
      sourceCount: number;
      error?: string;
    };
    systemAudioHealth: {
      status: 'granted'|'denied'|'not-determined'|'restricted';
      backend: 'coreaudio' | 'sck' | 'wasapi' | 'unknown';
      services: string[];
      capturable: boolean;
      effectiveGranted: boolean;
      staleGrantSuspected: boolean;
      recommendedFix: 'open-settings' | 'reset-tcc' | 'restart-app' | 'none';
      sourceCount: number;
      error?: string;
    };
    microphoneHealth: {
      status: 'granted'|'denied'|'not-determined'|'restricted';
      capturable: boolean;
      effectiveGranted: boolean;
      staleGrantSuspected: boolean;
      recommendedFix: 'open-settings' | 'reset-tcc' | 'restart-app' | 'none';
      sourceCount: number;
      error?: string;
    };
  }>
  // @ipc-channel permissions:request-mic
  requestMicPermission: () => Promise<boolean>
  // @ipc-channel permissions:repair-tcc
  repairTccPermission: (scope: 'screen' | 'microphone' | 'both') => Promise<{ success: boolean; bundleId: string | null; commandsRun: string[]; requiresRestart: boolean; error?: string }>
  // @ipc-channel permissions:restart-after-repair
  restartAfterTccRepair: () => Promise<{ success: boolean }>

  // STT Provider Management
  // @ipc-channel set-stt-provider
  setSttProvider: (provider: 'none' | 'google' | 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'doubao' | 'doubao-auc' | 'qcloud-stt' | 'natively' | 'local-whisper' | 'local-sensevoice') => Promise<{ success: boolean; error?: string }>
  // @ipc-channel get-stt-provider
  getSttProvider: () => Promise<string>
  // @ipc-channel get-speaker-separation-mode
  getSpeakerSeparationMode: () => Promise<'auto' | 'off'>
  // @ipc-channel set-speaker-separation-mode
  setSpeakerSeparationMode: (mode: 'auto' | 'off') => Promise<{ success: boolean; error?: string }>
  // @ipc-channel get-speaker-verification-mode
  getSpeakerVerificationMode: () => Promise<SpeakerVerificationMode>
  // @ipc-channel set-speaker-verification-mode
  setSpeakerVerificationMode: (mode: SpeakerVerificationMode) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel speaker-verification:get-status
  speakerVerificationGetStatus: () => Promise<SpeakerVerificationStatus>
  // @ipc-channel speaker-verification:enroll
  speakerVerificationEnroll: (samples: SpeakerEnrollmentSample[]) => Promise<{ success: boolean; status?: SpeakerVerificationStatus; error?: string }>
  // @ipc-channel speaker-verification:delete-profile
  speakerVerificationDeleteProfile: () => Promise<{ success: boolean; error?: string }>
  // @ipc-channel local-sensevoice-get-models
  localSenseVoiceGetModels: () => Promise<{ models: any[]; activeModelId: string }>
  // @ipc-channel local-sensevoice-get-terms
  localSenseVoiceGetTerms: () => Promise<{ terms: LocalSenseVoiceTermEntry[]; correctionEnabled: boolean }>
  // @ipc-channel local-sensevoice-set-terms
  localSenseVoiceSetTerms: (input: { terms: LocalSenseVoiceTermEntry[]; correctionEnabled?: boolean }) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel local-sensevoice-delete-model
  localSenseVoiceDeleteModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel local-sensevoice-start-download
  localSenseVoiceStartDownload: (modelId: string) => Promise<{ success: boolean; error?: string }>
  onLocalSenseVoiceDownloadProgress: (callback: (data: { modelId: string; progress: number }) => void) => () => void
  onLocalSenseVoiceDownloadComplete: (callback: (data: { modelId: string }) => void) => () => void
  onLocalSenseVoiceDownloadError: (callback: (data: { modelId: string; error: string }) => void) => () => void
  // @ipc-channel local-sensevoice-preload
  localSenseVoicePreload: (modelId?: string) => Promise<{ success: boolean; reason?: string; error?: string }>
  // @ipc-channel local-models-get-list
  localModelsGetList: () => Promise<{ models: any[] }>
  // @ipc-channel local-models-start-download
  localModelsStartDownload: (modelId: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel local-models-delete-model
  localModelsDeleteModel: (modelId: string) => Promise<{ success: boolean; error?: string }>
  onLocalModelsDownloadProgress: (callback: (data: { modelId: string; progress: number }) => void) => () => void
  onLocalModelsDownloadComplete: (callback: (data: { modelId: string }) => void) => () => void
  onLocalModelsDownloadError: (callback: (data: { modelId: string; error: string }) => void) => () => void
  // @ipc-channel local-whisper-get-channel-config
  localWhisperGetChannelConfig: () => Promise<{ enabled: boolean; micModelId: string; systemModelId: string; globalModelId: string }>
  // @ipc-channel local-whisper-set-channel-config
  localWhisperSetChannelConfig: (cfg: { enabled?: boolean; micModelId?: string; systemModelId?: string }) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-groq-stt-api-key
  setGroqSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-openai-stt-api-key
  setOpenAiSttApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-openai-stt-base-url
  setOpenAiSttBaseUrl: (url: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-deepgram-api-key
  setDeepgramApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-elevenlabs-api-key
  setElevenLabsApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-azure-api-key
  setAzureApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-azure-region
  setAzureRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-ibmwatson-api-key
  setIbmWatsonApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-groq-stt-model
  setGroqSttModel: (model: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-soniox-api-key
  setSonioxApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  setDoubaoApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel set-ibmwatson-region
  setIbmWatsonRegion: (region: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel test-stt-connection
  testSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'doubao' | 'doubao-auc' | 'qcloud-stt', apiKey: string, region?: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel test-saved-stt-connection
  testSavedSttConnection: (provider: 'groq' | 'openai' | 'deepgram' | 'elevenlabs' | 'azure' | 'ibmwatson' | 'soniox' | 'doubao' | 'doubao-auc' | 'qcloud-stt', region?: string) => Promise<{ success: boolean; error?: string }>

  // STT Config Events (fired when STT provider/key changes during a meeting)
  onSttConfigChanged: (callback: (data: { configured: boolean; provider: string }) => void) => () => void
  onCredentialsChanged: (callback: () => void) => () => void

  // Native Audio Service Events
  onNativeAudioTranscript: (callback: (transcript: NativeAudioTranscriptPayload) => void) => () => void
  onNativeAudioSuggestion: (callback: (suggestion: { context: string; lastQuestion: string; confidence: number }) => void) => () => void
  onNativeAudioConnected: (callback: () => void) => () => void
  onNativeAudioDisconnected: (callback: () => void) => () => void
  onSuggestionGenerated: (callback: (data: { question: string; suggestion: string; confidence: number }) => void) => () => void
  onSuggestionProcessingStart: (callback: () => void) => () => void
  onSuggestionError: (callback: (error: { error: string }) => void) => () => void
  // @ipc-channel generate-suggestion
  generateSuggestion: (context: string, lastQuestion: string) => Promise<{ suggestion: string }>
  // @ipc-channel get-input-devices
  getInputDevices: () => Promise<Array<{ id: string; name: string }>>
  // @ipc-channel get-output-devices
  getOutputDevices: () => Promise<Array<{ id: string; name: string }>>
  // @ipc-channel set-recognition-language
  setRecognitionLanguage: (key: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel get-ai-response-languages
  getAiResponseLanguages: () => Promise<Array<{ label: string; code: string }>>
  // @ipc-channel set-ai-response-language
  setAiResponseLanguage: (language: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel get-stt-language
  getSttLanguage: () => Promise<string>
  // @ipc-channel get-stt-language-compatibility
  getSttLanguageCompatibility: () => Promise<{
    requestedLanguageKey: string;
    effectiveLanguageKey: string;
    willHonorSelection: boolean;
    reasonCode: 'AUTO_NORMALIZED_TO_ENGLISH' | 'MODEL_ENGLISH_ONLY' | 'PROVIDER_LANGUAGE_UNSUPPORTED' | 'SUPPORTED';
    message: string;
  }>
  // @ipc-channel get-ai-response-language
  getAiResponseLanguage: () => Promise<string>
  onSttLanguageAutoDetected: (callback: (bcp47: string) => void) => () => void
  onSystemAudioPermissionDenied: (callback: (message: string) => void) => () => void
  onDeviceSelectionApplied: (callback: (payload: { kind: 'input' | 'output'; requested: string | null; actual: string | null; fellBack: boolean; reason?: string }) => void) => () => void
  onAudioCaptureFailed: (callback: (payload: { channel: 'system' | 'mic'; message: string; /** Known sentinels: 'CORE_AUDIO_TCC_RESET_REQUIRED' (macOS CoreAudio zero-fill = stale TCC grant for ScreenCaptureKit/system audio), 'MIC_TCC_RESET_REQUIRED' (macOS microphone permission stale grant). New diagnostic codes can be added freely; consumers should treat unknown codes as non-fatal. */ code?: string; recommendedFix?: 'open-settings' | 'reset-tcc' | 'restart-app' | 'none'; staleGrantSuspected?: boolean; attempt: number; maxAttempts: number; backend?: string; routeDiagnostics?: { requestedOutputId: string | null; requestedOutputName: string | null; defaultOutputId: string | null; defaultOutputName: string | null; usingDefaultRoute: boolean; selectedDiffersFromDefault: boolean }; terminal?: boolean; stuck?: boolean }) => void) => () => void

  // STT Status Events
  onSttStatusChanged: (callback: (data: { state: 'connected' | 'reconnecting' | 'failed'; provider: string; error?: string; channel: 'user' | 'interviewer'; reconnectAttempts?: number }) => void) => () => void

  // @ipc-channel native-audio-status
  getNativeAudioStatus: () => Promise<{ connected: boolean }>

  // Intelligence Mode IPC
  // @ipc-channel generate-assist
  generateAssist: () => Promise<{ insight: string | null }>
  // @ipc-channel generate-what-to-say
  generateWhatToSay: (question?: string, imagePaths?: string[], options?: { promptInstruction?: string; persist?: boolean; source?: 'overlay' | 'launcher' | 'dynamic_action'; requestId?: string; modeEvent?: DynamicActionModeEvent }) => Promise<{
    answerId?: string;
    answer: string | null;
    question?: string;
    error?: string;
    statusCode?: 'ok' | 'invalid-request' | 'no-context' | 'no-result' | 'retrieval-error' | 'permission-denied' | 'scope-rejected' | 'provider-error' | 'answer-trace-unavailable' | 'partial-trace-unavailable' | 'business-system-unavailable';
    contextTrace?: AnswerContextTrace | null;
    degradedReason?: string;
    citations?: AnswerCitation[];
    /** Vision pipeline outcome — replaces legacy screenContextStatus/ocrTextLength fields */
    screenContextStatus?: 'not_available' | 'available' | 'failed';
    visionProviderUsed?: string;
    visionModelUsed?: string;
    visionAttempts?: number;
    visionFailureReason?: 'no_vision_provider' | 'all_vision_failed' | 'privacy_blocked' | 'scope_blocked' | 'provider_timeout';
    imageCount?: number;
    usedImageInput?: boolean;
  }>
  // @ipc-channel generate-clarify
  generateClarify: () => Promise<{ clarification: string | null }>
  // @ipc-channel generate-code-hint
  generateCodeHint: (imagePaths?: string[], problemStatement?: string) => Promise<{ hint: string | null }>
  // @ipc-channel generate-brainstorm
  generateBrainstorm: (imagePaths?: string[], problemStatement?: string) => Promise<{ script: string | null }>
  // @ipc-channel generate-recap
  generateRecap: () => Promise<{ summary: string | null }>
  // @ipc-channel submit-manual-question
  submitManualQuestion: (question: string) => Promise<{ answer: string | null; question: string }>
  // @ipc-channel get-intelligence-context
  getIntelligenceContext: () => Promise<{ context: string; lastAssistantMessage: string | null; activeMode: string }>
  // @ipc-channel reset-intelligence
  resetIntelligence: () => Promise<{ success: boolean; error?: string }>

  // Dynamic Action Button Mode
  // @ipc-channel get-action-button-mode
  getActionButtonMode: () => Promise<'recap' | 'brainstorm'>
  // @ipc-channel set-action-button-mode
  setActionButtonMode: (mode: 'recap' | 'brainstorm') => Promise<{ success: boolean }>
  onActionButtonModeChanged: (callback: (mode: 'recap' | 'brainstorm') => void) => () => void
  onModeChanged: (callback: (data: { id: string | null; name: string | null }) => void) => () => void

  // Modes
  // @ipc-channel modes:get-all
  modesGetAll: () => Promise<Array<{ id: string; name: string; templateType: string; customContext: string; intentKeywords: ModeIntentKeywordSetting[]; isActive: boolean; createdAt: string; referenceFileCount: number }>>
  // @ipc-channel modes:get-active
  modesGetActive: () => Promise<{ id: string; name: string; templateType: string; customContext: string; intentKeywords: ModeIntentKeywordSetting[]; isActive: boolean; createdAt: string } | null>
  // @ipc-channel modes:create
  modesCreate: (params: { name: string; templateType: string }) => Promise<{ success: boolean; mode?: any; error?: string }>
  // @ipc-channel modes:update
  modesUpdate: (id: string, updates: { name?: string; templateType?: string; customContext?: string; intentKeywords?: ModeIntentKeywordSetting[] }) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel modes:reset-intent-keywords
  modesResetIntentKeywords: (id: string) => Promise<{ success: boolean; intentKeywords?: ModeIntentKeywordSetting[]; error?: string }>
  // @ipc-channel modes:delete
  modesDelete: (id: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel modes:set-active
  modesSetActive: (id: string | null) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel modes:get-reference-files
  modesGetReferenceFiles: (modeId: string) => Promise<Array<{ id: string; modeId: string; fileName: string; content: string; createdAt: string }>>
  // @ipc-channel modes:upload-reference-file
  modesUploadReferenceFile: (modeId: string) => Promise<{ success: boolean; file?: any; cancelled?: boolean; error?: string }>
  // @ipc-channel modes:delete-reference-file
  modesDeleteReferenceFile: (id: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel modes:get-note-sections
  modesGetNoteSections: (modeId: string) => Promise<Array<{ id: string; modeId: string; title: string; description: string; sortOrder: number }>>
  // @ipc-channel modes:add-note-section
  modesAddNoteSection: (modeId: string, title: string, description: string) => Promise<{ success: boolean; section?: any; error?: string }>
  // @ipc-channel modes:update-note-section
  modesUpdateNoteSection: (id: string, updates: { title?: string; description?: string }) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel modes:delete-note-section
  modesDeleteNoteSection: (id: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel modes:remove-all-note-sections
  modesRemoveAllNoteSections: (modeId: string) => Promise<{ success: boolean; error?: string }>

  // Meeting Lifecycle
  // @ipc-channel start-meeting
  startMeeting: (metadata?: any) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel end-meeting
  endMeeting: () => Promise<{ success: boolean; error?: string }>
  // @ipc-channel finalize-mic-stt
  finalizeMicSTT: () => Promise<void>
  // @ipc-channel get-recent-meetings
  getRecentMeetings: () => Promise<Array<{ id: string; title: string; date: string; duration: string; summary: string }>>
  // @ipc-channel get-meeting-details
  getMeetingDetails: (id: string) => Promise<any>
  // @ipc-channel update-meeting-title
  updateMeetingTitle: (id: string, title: string) => Promise<boolean>
  // @ipc-channel update-meeting-summary
  updateMeetingSummary: (id: string, updates: { overview?: string, actionItems?: string[], keyPoints?: string[], actionItemsTitle?: string, keyPointsTitle?: string }) => Promise<boolean>
  // @ipc-channel delete-meeting
  deleteMeeting: (id: string) => Promise<boolean>
  // @ipc-channel set-window-mode
  setWindowMode: (mode: 'launcher' | 'overlay', inactive?: boolean) => Promise<void>

  // Phase 3 — Cluely-style dynamic action cards.
  onIntelligenceDynamicAction: (callback: (data: { action: DynamicActionPayload }) => void) => () => void
  // @ipc-channel dynamic-action:accept
  acceptDynamicAction: (actionId: string, options?: { triggerSource?: 'manual' | 'auto_countdown' }) => Promise<{ success: boolean; action?: DynamicActionPayload; error?: string }>
  // @ipc-channel dynamic-action:complete
  completeDynamicAction: (actionId: string) => Promise<{ success: boolean; action?: DynamicActionPayload; error?: string }>
  // @ipc-channel dynamic-action:generation-failed
  failDynamicActionGeneration: (actionId: string) => Promise<{ success: boolean; action?: DynamicActionPayload; error?: string }>
  // @ipc-channel dynamic-action:dismiss
  dismissDynamicAction: (actionId: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel dynamic-action:list
  listDynamicActions: () => Promise<{ success: boolean; actions: DynamicActionPayload[]; error?: string }>

  // Intelligence Mode Events
  onIntelligenceAssistUpdate: (callback: (data: { insight: string }) => void) => () => void
  onIntelligenceSuggestedAnswerToken: (callback: (data: { token: string; question: string; confidence: number; requestId?: string }) => void) => () => void
  onIntelligenceSuggestedAnswer: (callback: (data: { answer: string; question: string; confidence: number; requestId?: string }) => void) => () => void
  // Sprint 7: dedicated negotiation-coaching channel.
  onIntelligenceNegotiationCoaching: (callback: (data: { payload: any }) => void) => () => void
  // Sprint 9: time-batched IPC token channel.
  onIntelligenceTokenBatch: (callback: (data: { kind: 'suggested_answer' | 'refined_answer' | 'recap' | 'clarify'; items: any[] }) => void) => () => void
  onIntelligenceRefinedAnswerToken: (callback: (data: { token: string; intent: string }) => void) => () => void
  onIntelligenceRefinedAnswer: (callback: (data: { answer: string; intent: string }) => void) => () => void
  onIntelligenceRecap: (callback: (data: { summary: string }) => void) => () => void
  onIntelligenceRecapToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceClarify: (callback: (data: { clarification: string }) => void) => () => void
  onIntelligenceClarifyToken: (callback: (data: { token: string }) => void) => () => void
  onIntelligenceManualStarted: (callback: () => void) => () => void
  onIntelligenceManualResult: (callback: (data: { answer: string; question: string }) => void) => () => void
  onIntelligenceModeChanged: (callback: (data: { mode: string }) => void) => () => void
  onIntelligenceError: (callback: (data: { error: string, mode: string, requestId?: string }) => void) => () => void;
  // Session Management
  onSessionReset: (callback: () => void) => () => void;

  // Streaming listeners
  // @ipc-channel gemini-chat-stream
  streamGeminiChat: (message: string, imagePaths?: string[], context?: string, options?: { skipSystemPrompt?: boolean, ignoreKnowledgeMode?: boolean }) => Promise<void>
  onGeminiStreamToken: (callback: (token: string) => void) => () => void
  onGeminiStreamDone: (callback: () => void) => () => void
  onGeminiStreamError: (callback: (error: string) => void) => () => void;
  onChatContextStatus: (callback: (payload: ChatContextStatusPayload) => void) => () => void;

  // Model Management
  // @ipc-channel get-default-model
  getDefaultModel: () => Promise<{ model: string }>;
  // @ipc-channel set-model
  setModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  // @ipc-channel set-default-model
  setDefaultModel: (modelId: string) => Promise<{ success: boolean; error?: string }>;
  // @ipc-channel toggle-model-selector
  toggleModelSelector: (coords: { x: number; y: number }) => Promise<void>;
  // @ipc-channel model-selector:close-if-open
  modelSelectorCloseIfOpen: () => Promise<void>;
  // @ipc-channel force-restart-ollama
  forceRestartOllama: () => Promise<void>;

  // Settings Window
  toggleSettingsWindow: (coords?: { x: number; y: number }) => Promise<void>;
  openModesManager: () => Promise<void>;

  // @ipc-channel get-codex-cli-config
  getCodexCliConfig: () => Promise<{ enabled: boolean; path: string; model: string; timeoutMs: number; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' }>;
  // @ipc-channel set-codex-cli-config
  setCodexCliConfig: (config: { enabled: boolean; path: string; model: string; timeoutMs: number; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' }) => Promise<{ success: boolean; error?: string; config?: { enabled: boolean; path: string; model: string; timeoutMs: number; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' } }>;
  // @ipc-channel test-codex-cli
  testCodexCli: (config?: { enabled?: boolean; path?: string; model?: string; timeoutMs?: number; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' }) => Promise<{ success: boolean; error?: string; resolvedPath?: string; config?: { enabled: boolean; path: string; model: string; timeoutMs: number; sandboxMode?: 'read-only' | 'workspace-write' | 'danger-full-access' } }>;

  // Demo
  // @ipc-channel seed-demo
  seedDemo: () => Promise<{ success: boolean }>;

  // Custom Providers
  // @ipc-channel save-custom-provider
  saveCustomProvider: (provider: any) => Promise<{ success: boolean; id?: string; error?: string }>;
  // @ipc-channel get-custom-providers
  getCustomProviders: () => Promise<any[]>;
  // @ipc-channel delete-custom-provider
  deleteCustomProvider: (id: string) => Promise<{ success: boolean; error?: string }>;
  // @ipc-channel business-system:list-sources
  getBusinessSystemKnowledgeSources: () => Promise<Array<{
    id: string
    name: string
    kind: 'plm' | 'qms' | 'business_system'
    url: string
    authType: 'api_key' | 'username_password'
    enabled: boolean
    isDefault?: boolean
    credentialState: { hasApiKey: boolean; hasUsername: boolean; hasPassword: boolean }
  }>>
  // @ipc-channel business-system:save-source
  saveBusinessSystemKnowledgeSource: (input: any) => Promise<{ success: boolean; id?: string; error?: string }>
  // @ipc-channel business-system:delete-source
  deleteBusinessSystemKnowledgeSource: (id: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel business-system:test-source
  testBusinessSystemKnowledgeSource: (input: any) => Promise<{ success: boolean; status?: string; sourceName?: string; error?: string; message?: string; detailCode?: string; toolCount?: number }>

  // Audio Test
  // @ipc-channel start-audio-test
  startAudioTest: (deviceId?: string) => Promise<{ success: boolean }>;
  // @ipc-channel stop-audio-test
  stopAudioTest: () => Promise<{ success: boolean }>;
  onAudioTestLevel: (callback: (level: number) => void) => () => void;

  // Database
  // @ipc-channel flush-database
  flushDatabase: () => Promise<{ success: boolean }>;

  onModelChanged: (callback: (modelId: string) => void) => () => void;
  onOpenModesManager: (callback: () => void) => () => void;

  onOllamaPullProgress: (callback: (data: { status: string; percent: number }) => void) => () => void;
  onOllamaPullComplete: (callback: () => void) => () => void;

  onMeetingsUpdated: (callback: () => void) => () => void

  // Provider Compatibility
  onIncompatibleProviderWarning: (callback: (data: { count: number, oldProvider: string, newProvider: string }) => void) => () => void;
  // @ipc-channel rag:reindex-incompatible-meetings
  reindexIncompatibleMeetings: () => Promise<void>;

  // Theme API
  // @ipc-channel theme:get-mode
  getThemeMode: () => Promise<{ mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }>
  // @ipc-channel theme:set-mode
  setThemeMode: (mode: 'system' | 'light' | 'dark') => Promise<void>
  onThemeChanged: (callback: (data: { mode: 'system' | 'light' | 'dark', resolved: 'light' | 'dark' }) => void) => () => void

  // Auto-Update
  onUpdateAvailable: (callback: (info: any) => void) => () => void
  onUpdateDownloaded: (callback: (info: any) => void) => () => void
  onUpdateChecking: (callback: () => void) => () => void
  onUpdateNotAvailable: (callback: (info: any) => void) => () => void
  onUpdateError: (callback: (err: string) => void) => () => void
  onDownloadProgress: (callback: (progressObj: any) => void) => () => void
  // @ipc-channel quit-and-install-update
  restartAndInstall: () => Promise<void>
  // @ipc-channel check-for-updates
  checkForUpdates: () => Promise<void>
  // @ipc-channel download-update
  downloadUpdate: () => Promise<void>
  // @ipc-channel test-release-fetch
  testReleaseFetch: () => Promise<{ success: boolean; error?: string }>

  // RAG (Retrieval-Augmented Generation) API
  // @ipc-channel rag:query-meeting
  ragQueryMeeting: (meetingId: string, query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  // @ipc-channel rag:query-live
  ragQueryLive: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  // @ipc-channel rag:query-global
  ragQueryGlobal: (query: string) => Promise<{ success?: boolean; fallback?: boolean; error?: string }>
  // @ipc-channel rag:cancel-query
  ragCancelQuery: (options: { meetingId?: string; global?: boolean }) => Promise<{ success: boolean }>
  // @ipc-channel rag:is-meeting-processed
  ragIsMeetingProcessed: (meetingId: string) => Promise<boolean>
  // @ipc-channel rag:get-queue-status
  ragGetQueueStatus: () => Promise<{ pending: number; processing: number; completed: number; failed: number }>
  // @ipc-channel rag:retry-embeddings
  ragRetryEmbeddings: () => Promise<{ success: boolean }>
  // @ipc-channel track-answer-quality-event
  trackAnswerQualityEvent: (input: { answerId: string; eventType: AnswerQualityEventType; surface?: string; metadata?: AnswerQualityEventMetadata }) => Promise<{ success: boolean; id?: string; error?: string }>
  // @ipc-channel get-answer-quality-metrics
  getAnswerQualityMetrics: (input?: { sinceMs?: number; mode?: string }) => Promise<{ success: boolean; metrics?: AnswerQualityMetrics; error?: string }>
  // @ipc-channel quality:get-realtime-diagnostics-summary
  getRealtimeDiagnosticsSummary: (input?: { sinceMs?: number; mode?: string }) => Promise<{ success: boolean; summary?: RealtimeDiagnosticsSummary; error?: string }>
  // @ipc-channel open-answer-citation
  openAnswerCitation: (input: { answerId: string; citationId: string }) => Promise<{ success: boolean; status: 'ok' | 'stale-citation' | 'missing-citation' | 'unsupported-citation'; previewText?: string | null; citation?: AnswerCitation; error?: string }>
  // @ipc-channel get-context-health
  getContextHealth: () => Promise<ContextHealth>
  // @ipc-channel knowledge:select-materials
  knowledgeSelectMaterials: () => Promise<{ success?: boolean; cancelled?: boolean; filePaths?: string[]; error?: string }>
  // @ipc-channel knowledge:check-qcloud-availability
  knowledgeCheckQCloudAvailability: () => Promise<{ success: boolean; hasNativelyApiKey: boolean; activeProvider: string; available: boolean; error?: string }>
  // @ipc-channel knowledge:upload-materials
  knowledgeUploadMaterials: (filePaths: string[]) => Promise<{ success: boolean; materials: KnowledgeMaterial[]; errors?: Array<{ filePath: string; error: string }> }>
  // @ipc-channel knowledge:list-materials
  knowledgeListMaterials: () => Promise<{ success: boolean; materials: KnowledgeMaterial[]; error?: string }>
  // @ipc-channel knowledge:delete-material
  knowledgeDeleteMaterial: (id: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel knowledge:reindex-material
  knowledgeReindexMaterial: (id: string) => Promise<{ success: boolean; material?: KnowledgeMaterial; error?: string }>
  onRAGStreamChunk: (callback: (data: { meetingId?: string; global?: boolean; chunk: string }) => void) => () => void
  onRAGStreamComplete: (callback: (data: { meetingId?: string; global?: boolean }) => void) => () => void
  onRAGStreamError: (callback: (data: { meetingId?: string; global?: boolean; error: string }) => void) => () => void

  // Keybind Management
  getKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  setKeybind: (id: string, accelerator: string) => Promise<boolean>
  resetKeybinds: () => Promise<Array<{ id: string; label: string; accelerator: string; isGlobal: boolean; defaultAccelerator: string }>>
  onKeybindsUpdate: (callback: (keybinds: Array<any>) => void) => () => void
  onKeybindRegistrationFailed: (callback: (data: { id: string; accelerator: string }) => void) => () => void
  onGlobalShortcut: (callback: (data: { action: string }) => void) => () => void

  // Profile Engine API
  // @ipc-channel profile:upload-resume
  profileUploadResume: (filePath: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:get-status
  profileGetStatus: () => Promise<{ hasProfile: boolean; profileMode: boolean; name?: string; role?: string; totalExperienceYears?: number }>
  // @ipc-channel profile:set-mode
  profileSetMode: (enabled: boolean) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:delete
  profileDelete: () => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:get-profile
  profileGetProfile: () => Promise<any>
  // @ipc-channel profile:select-file
  profileSelectFile: () => Promise<{ success?: boolean; cancelled?: boolean; filePath?: string; error?: string }>
  // @ipc-channel profile:get-active-scenario
  profileGetActiveScenario: () => Promise<{ success: boolean; scenario?: any; error?: string }>
  // @ipc-channel profile:list-documents
  profileListDocuments: (params?: { modeId?: string }) => Promise<{ success: boolean; documents: any[]; error?: string }>
  // @ipc-channel profile:upload-document
  profileUploadDocument: (params: { filePath: string; docSubtype: string }) => Promise<{ success: boolean; id?: string; error?: string }>
  // @ipc-channel profile:update-document-subtype
  profileUpdateDocumentSubtype: (params: { referenceFileId: string; docSubtype: string }) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:delete-document
  profileDeleteDocument: (params: { referenceFileId: string }) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:get-master-profile
  profileGetMasterProfile: () => Promise<{ success: boolean; profile?: any; error?: string }>
  // @ipc-channel profile:update-master-profile
  profileUpdateMasterProfile: (profile: any) => Promise<{ success: boolean; error?: string }>

  // JD & Research API
  // @ipc-channel profile:upload-jd
  profileUploadJD: (filePath: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:delete-jd
  profileDeleteJD: () => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:research-company
  profileResearchCompany: (companyName: string, options?: { forceRefresh?: boolean; requestId?: string }) => Promise<{ success: boolean; dossier?: any; cached?: boolean; searchQuotaExhausted?: boolean; error?: string; errorCode?: string }>
  onResearchProgressChanged: (callback: (data: ResearchProgressPayload) => void) => () => void
  // @ipc-channel profile:clear-research-cache
  profileClearResearchCache: () => Promise<{ success: boolean; deleted?: number; error?: string }>
  // @ipc-channel profile:test-tavily-key
  testTavilyApiKey: (key: string) => Promise<{ valid: boolean; reason?: string; quotaLow?: boolean; message?: string }>
  // @ipc-channel profile:generate-negotiation
  profileGenerateNegotiation: (force?: boolean) => Promise<{ success: boolean; script?: any; error?: string }>
  // @ipc-channel profile:get-negotiation-state
  profileGetNegotiationState: () => Promise<{ success: boolean; state?: any; isActive?: boolean; error?: string }>
  // @ipc-channel profile:reset-negotiation
  profileResetNegotiation: () => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:get-notes
  profileGetNotes: () => Promise<{ success: boolean; content: string; error?: string }>
  // @ipc-channel profile:save-notes
  profileSaveNotes: (content: string) => Promise<{ success: boolean; error?: string }>
  // @ipc-channel profile:get-persona
  profileGetPersona: () => Promise<{ success: boolean; content: string; error?: string }>
  // @ipc-channel profile:save-persona
  profileSavePersona: (content: string) => Promise<{ success: boolean; error?: string }>

  // Tavily Search API
  // @ipc-channel set-tavily-api-key
  setTavilyApiKey: (apiKey: string) => Promise<{ success: boolean; error?: string }>

  // Dynamic Model Discovery
  // @ipc-channel fetch-provider-models
  fetchProviderModels: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao', apiKey: string) => Promise<{ success: boolean; models?: {id: string, label: string}[]; error?: string }>
  // @ipc-channel set-provider-preferred-model
  setProviderPreferredModel: (provider: 'gemini' | 'groq' | 'openai' | 'claude' | 'doubao', modelId: string) => Promise<void>

  // Overlay Opacity (Stealth Mode)
  // @ipc-channel set-overlay-opacity
  setOverlayOpacity: (opacity: number) => Promise<void>;
  onOverlayOpacityChanged: (callback: (opacity: number) => void) => () => void;

  // Verbose / Debug Logging
  // @ipc-channel get-verbose-logging
  getVerboseLogging: () => Promise<boolean>;
  // @ipc-channel set-verbose-logging
  setVerboseLogging: (enabled: boolean) => Promise<{ success: boolean }>;
  // @ipc-channel export-qa-report
  exportQaReport: () => Promise<{
    success: boolean;
    filePath?: string;
    error?: string;
    cancelled?: boolean;
  }>;
  // @ipc-channel get-meeting-retention
  getMeetingRetention: () => Promise<'forever' | '7d' | '30d' | 'never'>;
  // @ipc-channel set-meeting-retention
  setMeetingRetention: (retention: 'forever' | '7d' | '30d' | 'never') => Promise<{ success: boolean; error?: string }>;
  onMeetingRetentionChanged: (callback: (retention: 'forever' | '7d' | '30d' | 'never') => void) => () => void;
  // @ipc-channel get-provider-data-scopes
  getProviderDataScopes: () => Promise<{ transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }>;
  // @ipc-channel set-provider-data-scopes
  setProviderDataScopes: (scopes: { transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }) => Promise<{ success: boolean; error?: string }>;
  onProviderDataScopesChanged: (callback: (scopes: { transcript?: boolean; screenshots?: boolean; reference_files?: boolean; profile_history?: boolean; embeddings?: boolean; post_call_summary?: boolean }) => void) => () => void;
  // @ipc-channel get-screen-understanding-mode
  getScreenUnderstandingMode: () => Promise<'vision_first' | 'vision_only' | 'private_vision'>;
  // @ipc-channel set-screen-understanding-mode
  setScreenUnderstandingMode: (mode: 'vision_first' | 'vision_only' | 'private_vision') => Promise<{ success: boolean; error?: string }>;
  onScreenUnderstandingModeChanged: (callback: (mode: 'vision_first' | 'vision_only' | 'private_vision') => void) => () => void;
  onSpeakerSeparationModeChanged: (callback: (mode: 'auto' | 'off') => void) => () => void;
  // @ipc-channel get-technical-interview-vision-first
  getTechnicalInterviewVisionFirst: () => Promise<boolean>;
  // @ipc-channel set-technical-interview-vision-first
  setTechnicalInterviewVisionFirst: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onTechnicalInterviewVisionFirstChanged: (callback: (enabled: boolean) => void) => () => void;
  // @ipc-channel get-local-intent-enhancement-enabled
  getLocalIntentEnhancementEnabled: () => Promise<boolean>;
  // @ipc-channel set-local-intent-enhancement-enabled
  setLocalIntentEnhancementEnabled: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  onLocalIntentEnhancementEnabledChanged: (callback: (enabled: boolean) => void) => () => void;
  /** @deprecated alias retained for older renderer builds — maps to technicalInterviewVisionFirst */
  // @ipc-channel get-technical-interview-direct-vision
  getTechnicalInterviewDirectVision: () => Promise<boolean>;
  /** @deprecated alias retained for older renderer builds — maps to technicalInterviewVisionFirst */
  // @ipc-channel set-technical-interview-direct-vision
  setTechnicalInterviewDirectVision: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
  /** @deprecated alias retained for older renderer builds — maps to technicalInterviewVisionFirstChanged */
  onTechnicalInterviewDirectVisionChanged: (callback: (enabled: boolean) => void) => () => void;
  // @ipc-channel get-log-file-path
  getLogFilePath: () => Promise<string | null>;
  // @ipc-channel open-log-file
  openLogFile: () => Promise<{ success: boolean; error?: string }>;

  // Arch
  // @ipc-channel get-arch
  getArch: () => Promise<string>;
  // @ipc-channel get-os-version
  getOsVersion: () => Promise<string>;

  // Cropper API
  cropperConfirmed: (bounds: { x: number; y: number; width: number; height: number }) => void;
  cropperCancelled: () => void;
  onResetCropper: (callback: (data: { hudPosition: { x: number; y: number } }) => void) => () => void;

  // Platform
  platform: NodeJS.Platform;

  // Skills
  skillsRefresh: () => Promise<SkillSummary[]>;
  // @ipc-channel skills:open-folder
  skillsOpenFolder: () => Promise<{ success: boolean; path: string; error?: string }>;
  // @ipc-channel skills:get-settings
  skillsGetSettings: () => Promise<SkillSettings>;
  // @ipc-channel skills:set-settings
  skillsSetSettings: (settings: SkillSettings) => Promise<{ success: boolean; error?: string }>;
  // @ipc-channel skills:list-activations
  skillsListActivations: () => Promise<SkillActivation[]>;
  // @ipc-channel skills:activate
  skillsActivate: (input: {
    skillId: string;
    scope?: SkillActivation['scope'];
    source?: SkillActivation['source'];
    ttlMs?: number;
    reason?: string;
  }) => Promise<{ success: boolean; error?: string }>;
  // @ipc-channel skills:deactivate
  skillsDeactivate: (skillId: string, scope?: SkillActivation['scope']) => Promise<{ success: boolean; error?: string }>;
  // @ipc-channel skills:get-watcher-settings
  skillsGetWatcherSettings: () => Promise<SkillWatcherSettings>;
  // @ipc-channel skills:set-watcher-settings
  skillsSetWatcherSettings: (settings: Partial<SkillWatcherSettings>) => Promise<{ success: boolean; settings?: SkillWatcherSettings; error?: string }>;
  // @ipc-channel skills:list-watcher-suggestions
  skillsListWatcherSuggestions: () => Promise<SkillWatcherSuggestion[]>;
  // @ipc-channel skills:accept-watcher-suggestion
  skillsAcceptWatcherSuggestion: (suggestionId: string) => Promise<{ success: boolean; suggestion?: SkillWatcherSuggestion; error?: string }>;
  // @ipc-channel skills:dismiss-watcher-suggestion
  skillsDismissWatcherSuggestion: (suggestionId: string) => Promise<{ success: boolean; suggestion?: SkillWatcherSuggestion; error?: string }>;
  // @ipc-channel transcript-skills:run
  transcriptSkillRun: (input: TranscriptSkillRunInput) => Promise<TranscriptSkillRunResult>;
  // @ipc-channel shell:open-path
  openPath: (targetPath: string) => Promise<{ success: boolean; error?: string }>;
  onSkillWatcherSuggestionCreated: (callback: (data: { suggestion: SkillWatcherSuggestion }) => void) => () => void;

}

export interface TranscriptSkillRunInput {
  skillId: string;
  meetingId?: string;
  meetingTitle?: string;
  transcriptMarkdown: string;
}

export interface TranscriptSkillRunResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: 'builtin' | 'userData';
}

export interface SkillActivation {
  skillId: string;
  scope: 'global_default' | 'meeting' | 'session' | 'turn' | 'ephemeral';
  source: 'default' | 'user' | 'voice' | 'auto' | 'post_call';
  activatedAt: number;
  expiresAt?: number;
  reason?: string;
}

export interface SkillSettings {
  defaultActiveSkillIds: string[];
  skillsAutoTriggerEnabled: boolean;
}

export interface SkillWatcherSettings {
  skillsWatcherEnabled: boolean;
  skillsWatcherAutoActivateThreshold: number;
  skillsWatcherSuggestThreshold: number;
}

export interface SkillWatcherSuggestion {
  id: string;
  skillId: string;
  action: 'suggest';
  scope: 'meeting' | 'ephemeral';
  confidence: number;
  reason: string;
  expiresAt?: number;
  createdAt: number;
  status: 'pending' | 'accepted' | 'dismissed';
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
