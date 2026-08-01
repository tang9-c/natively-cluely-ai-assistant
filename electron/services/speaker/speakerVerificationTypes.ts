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
  enabled: boolean;
  enrolledAt?: number;
  model?: string;
  mode: SpeakerVerificationMode;
  health: SpeakerVerificationHealth;
  stats: SpeakerVerificationStats;
}

export type SpeakerVerificationHealthState =
  | 'not_enrolled'
  | 'paused'
  | 'ready'
  | 'model_missing'
  | 'model_error'
  | 'degraded';

export interface SpeakerVerificationHealth {
  state: SpeakerVerificationHealthState;
  message?: string;
}

export interface SpeakerVerificationStats {
  totalVerifications: number;
  positiveVerifications: number;
  lowQualitySkips: number;
  lowConfidenceRejections: number;
  errorCount: number;
  lastVerifiedAt?: number;
  lastFailureAt?: number;
}

export type SpeakerVerificationQualityBand = 'stable' | 'weak_boundary' | 'needs_rerecord';

export interface SpeakerEnrollmentQualitySummary {
  minSelfSimilarity: number;
  meanSelfSimilarity: number;
  similarityStddev: number;
  calibratedThreshold: number;
  qualityScore: number;
  qualityBand: SpeakerVerificationQualityBand;
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
  quality?: SpeakerEnrollmentQualitySummary;
}

export interface SaveSpeakerProfileInput {
  embedding: Float32Array;
  embeddingDim: number;
  extractorModel: string;
  extractorVersion: string;
  threshold: number;
  deviceFingerprint?: string;
  sampleCount: number;
  quality?: SpeakerEnrollmentQualitySummary;
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
