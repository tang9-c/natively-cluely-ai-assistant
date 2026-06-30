export type SpeakerVerificationMode = 'off' | 'local';

export const SPEAKER_PROFILE_ME_ID = 'me' as const;
export const SPEAKER_PROFILE_ME_LABEL = 'ME' as const;

export interface SpeakerVerificationMetadata {
  provider: 'local-speaker-verification';
  profileId: typeof SPEAKER_PROFILE_ME_ID;
  isMe: boolean;
  confidence: number;
  threshold: number;
}

export interface SpeakerVerificationStatus {
  enrolled: boolean;
  enrolledAt?: number;
  model?: string;
  mode: SpeakerVerificationMode;
}

export interface SpeakerProfileRecord {
  id: typeof SPEAKER_PROFILE_ME_ID;
  label: typeof SPEAKER_PROFILE_ME_LABEL;
  embedding: Float32Array;
  embeddingDim: number;
  extractorModel: string;
  extractorVersion: string;
  threshold: number;
  enrolledAt: number;
  updatedAt: number;
  deviceFingerprint?: string;
  sampleCount: number;
}

export interface SaveSpeakerProfileInput {
  embedding: Float32Array;
  embeddingDim: number;
  extractorModel: string;
  extractorVersion: string;
  threshold: number;
  deviceFingerprint?: string;
  sampleCount: number;
  nowMs?: number;
}

export interface EnrollmentAudioSample {
  samples: Float32Array;
  sampleRate: number;
  deviceFingerprint?: string;
}

export interface AudioQualityResult {
  ok: boolean;
  durationMs: number;
  rms: number;
  voiceRatio: number;
  reason?: 'too_short' | 'too_quiet' | 'not_enough_voice' | 'empty';
}

export interface SpeakerEmbeddingExtractorLike {
  readonly dim: number;
  readonly modelId: string;
  readonly version: string;
  extract(samples16k: Float32Array): Promise<Float32Array>;
}

export interface SpeakerVerificationResult {
  status: 'verified' | 'not_enrolled' | 'disabled' | 'low_quality' | 'error';
  speakerVerification?: SpeakerVerificationMetadata;
  reason?: string;
}
