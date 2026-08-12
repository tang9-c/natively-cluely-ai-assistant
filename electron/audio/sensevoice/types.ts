export const SENSEVOICE_DEFAULT_MODEL_ID =
  'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17' as const;

export type SenseVoiceModelId = typeof SENSEVOICE_DEFAULT_MODEL_ID;

export type SenseVoiceModelStatus = 'available' | 'missing' | 'downloading' | 'error';

export interface SenseVoiceModelInfo {
  id: SenseVoiceModelId;
  name: string;
  sizeMb: number;
  status: SenseVoiceModelStatus;
  source?: 'downloaded';
  errorMessage?: string;
}

export interface SenseVoiceTermEntry {
  id: string;
  canonical: string;
  variants: string[];
  enabled: boolean;
}

export interface SenseVoiceTermCorrectionConfig {
  terms: SenseVoiceTermEntry[];
  enabled: boolean;
}

export interface SenseVoiceWorkerInitMessage {
  type: 'init';
  modelDir: string;
  modelFile: string;
  tokensFile: string;
  numThreads: number;
  requestedProviders?: string[];
  fallbackProvider?: string | null;
  verboseLogging?: boolean;
}

export interface SenseVoiceWorkerTranscribeMessage {
  type: 'transcribe';
  taskId: string;
  samples: Float32Array;
  verboseLogging?: boolean;
}

export type SenseVoiceWorkerInMessage =
  | SenseVoiceWorkerInitMessage
  | SenseVoiceWorkerTranscribeMessage;

export interface SenseVoiceWorkerReadyResponse {
  type: 'ready';
  providerRequested?: string;
  providerActual?: string;
  fallbackReason?: string | null;
  initializationMs?: number;
}

export interface SenseVoiceWorkerResultResponse {
  type: 'result';
  taskId: string;
  text: string;
}

export interface SenseVoiceWorkerErrorResponse {
  type: 'error';
  taskId?: string;
  message: string;
}

export type SenseVoiceWorkerOutMessage =
  | SenseVoiceWorkerReadyResponse
  | SenseVoiceWorkerResultResponse
  | SenseVoiceWorkerErrorResponse;
