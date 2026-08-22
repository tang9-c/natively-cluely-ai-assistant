import type {
  TranscriptEmotion,
  TranscriptEmotionDegree,
  TranscriptEmotionSource,
} from './senseVoiceEmotion';

export interface TranscriptSpeakerVerificationMetadata {
  provider: 'local-speaker-verification';
  profileId: 'me';
  isMe: boolean;
  confidence: number;
  threshold: number;
}

export interface NativeAudioTranscriptPayload {
  speaker: string;
  speakerId?: string;
  speakerLabel?: string;
  providerSpeakerId?: string;
  diarizationProvider?: 'doubao-auc' | 'qcloud';
  text: string;
  timestamp?: number;
  final: boolean;
  confidence?: number;
  startTimestampMs?: number;
  endTimestampMs?: number;
  emotion?: TranscriptEmotion;
  emotionSource?: TranscriptEmotionSource;
  emotionDegree?: TranscriptEmotionDegree;
  emotionScore?: number;
  emotionDegreeScore?: number;
  speakerVerification?: TranscriptSpeakerVerificationMetadata;
  coalescedFromCount?: number;
  coalescedProvider?: 'post_stt' | 'local_vad';
  rawSegmentIds?: string[];
}

export type TranscriptBatchFlushReason = 'timer' | 'max_size' | 'meeting_stop' | 'dispose';

export interface TranscriptBatchPayload {
  batchId: string;
  emittedAt: number;
  items: NativeAudioTranscriptPayload[];
}
