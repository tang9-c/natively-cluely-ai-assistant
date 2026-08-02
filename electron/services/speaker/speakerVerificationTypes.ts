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
  stats: SpeakerVerificationRuntimeStats;
  quality?: SpeakerEnrollmentQualitySummary;
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
  modelInstalled?: boolean;
  modelFile?: string;
  modelDim?: number;
  loadLatencyMs?: number;
  error?: string;
}

export type SpeakerVerificationOutcome =
  | 'positive'
  | 'low_confidence'
  | 'near_threshold_non_me'
  | 'low_quality'
  | 'error'
  | 'timeout';

export interface SpeakerVerificationRuntimeStats {
  totalVerifications: number;
  positiveVerifications: number;
  lowQualitySkips: number;
  lowConfidenceRejections: number;
  nearThresholdNonMeCount: number;
  errorCount: number;
  timeoutCount: number;
  avgLatencyMs?: number;
  latencySampleCount: number;
  lastVerifiedAt?: number;
  lastFailureAt?: number;
  lastOutcome?: SpeakerVerificationOutcome;
  lastError?: string;
  lastRecordedAt?: number;
}

export type SpeakerVerificationStats = SpeakerVerificationRuntimeStats;

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

export interface SpeakerRecordingQualityPolicy {
  minDurationMs: number;
  minRms: number;
  minVoiceRatio: number;
  voiceSampleThreshold: number;
  minVerificationDurationMs: number;
}

export interface SpeakerEmbeddingExtractorLike {
  readonly dim: number;
  readonly modelId: string;
  readonly version: string;
  extract(samples16k: Float32Array, options?: { signal?: AbortSignal }): Promise<Float32Array>;
}

export interface SpeakerVerificationResult {
  status: 'verified' | 'not_enrolled' | 'disabled' | 'low_quality' | 'error';
  speakerVerification?: SpeakerVerificationMetadata;
  reason?: string;
}
