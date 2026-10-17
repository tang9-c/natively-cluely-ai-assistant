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
  segmentId?: string;
  sessionGeneration?: string;
  canonicalSegmentId?: string;
  canonicalText?: string;
  canonicalRawSegmentIds?: string[];
  speakerIdentityCorrection?: import('./speakerIdentity').SpeakerIdentityCorrection;
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

export type SpeakerVerificationSessionOverride = {
  action: 'force_me' | 'force_not_me' | 'force_unknown' | 'clear';
} & ({
  segmentId: string;
  sessionGeneration: string;
  speaker?: string;
  timestamp?: number;
  text?: string;
} | {
  segmentId?: undefined;
  sessionGeneration?: string;
  speaker: string;
  timestamp: number;
  text: string;
});
