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

export interface SenseVoiceWorkerInitMessage {
  type: 'init';
  modelDir: string;
  modelFile: string;
  tokensFile: string;
  numThreads: number;
}

export interface SenseVoiceWorkerTranscribeMessage {
  type: 'transcribe';
  taskId: string;
  samples: Float32Array;
}

export type SenseVoiceWorkerInMessage =
  | SenseVoiceWorkerInitMessage
  | SenseVoiceWorkerTranscribeMessage;

export interface SenseVoiceWorkerReadyResponse {
  type: 'ready';
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
