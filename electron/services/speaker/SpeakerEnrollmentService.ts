import {
  cosineSimilarity,
  meanEmbedding,
  measureAudioQuality,
  resampleFloat32To16k,
  slidingWindows,
} from './speakerAudioUtils';
import type {
  EnrollmentAudioSample,
  SpeakerEnrollmentQualitySummary,
  SpeakerEmbeddingExtractorLike,
  SpeakerVerificationStatus,
} from './speakerVerificationTypes';
import type { SpeakerProfileStore } from './SpeakerProfileStore';

export interface SpeakerEnrollmentServiceOptions {
  store: Pick<SpeakerProfileStore, 'saveMeProfile' | 'getStatus'>;
  extractor: SpeakerEmbeddingExtractorLike;
  threshold?: number;
  now?: () => number;
}

export const DEFAULT_SPEAKER_THRESHOLD = 0.72;
export const MIN_ENROLLMENT_SELF_SIMILARITY = 0.78;
export const MAX_ENROLLMENT_SIMILARITY_STDDEV = 0.12;

function calculateQuality(embeddings: Float32Array[], embedding: Float32Array): SpeakerEnrollmentQualitySummary {
  const similarities = embeddings.map(candidate => cosineSimilarity(candidate, embedding));
  const minSelfSimilarity = Math.min(...similarities);
  const meanSelfSimilarity = similarities.reduce((sum, similarity) => sum + similarity, 0) / similarities.length;
  const similarityStddev = Math.sqrt(
    similarities.reduce((sum, similarity) => sum + (similarity - meanSelfSimilarity) ** 2, 0) / similarities.length,
  );
  const calibratedThreshold = Math.max(
    DEFAULT_SPEAKER_THRESHOLD,
    Math.min(0.86, minSelfSimilarity - 0.04),
  );
  const qualityScore = Math.max(0, Math.min(100, Math.round((meanSelfSimilarity - similarityStddev) * 100))) / 100;
  const qualityBand = minSelfSimilarity < calibratedThreshold
    ? 'needs_rerecord'
    : similarityStddev > 0.08
      ? 'weak_boundary'
      : 'stable';

  return {
    minSelfSimilarity,
    meanSelfSimilarity,
    similarityStddev,
    calibratedThreshold,
    qualityScore,
    qualityBand,
  };
}

export class SpeakerEnrollmentService {
  private readonly threshold: number;
  private readonly now: () => number;

  constructor(private readonly options: SpeakerEnrollmentServiceOptions) {
    this.threshold = options.threshold ?? DEFAULT_SPEAKER_THRESHOLD;
    this.now = options.now ?? Date.now;
  }

  async enroll(samples: EnrollmentAudioSample[]): Promise<SpeakerVerificationStatus> {
    if (samples.length < 3) {
      throw new Error('speaker_enrollment_requires_three_samples');
    }

    const embeddings: Float32Array[] = [];
    const deviceFingerprint = samples.find(sample => sample.deviceFingerprint)?.deviceFingerprint;

    for (const sample of samples) {
      const samples16k = resampleFloat32To16k(sample.samples, sample.sampleRate);
      const quality = measureAudioQuality(samples16k);
      if (!quality.ok) {
        throw new Error(`speaker_enrollment_quality_${quality.reason}`);
      }

      for (const window of slidingWindows(samples16k, 2000, 1000)) {
        const windowQuality = measureAudioQuality(window);
        if (!windowQuality.ok) continue;
        embeddings.push(await this.options.extractor.extract(window));
      }
    }

    if (embeddings.length < 3) {
      throw new Error('speaker_enrollment_not_enough_valid_windows');
    }

    const embedding = meanEmbedding(embeddings);
    const quality = calculateQuality(embeddings, embedding);
    if (
      quality.minSelfSimilarity < MIN_ENROLLMENT_SELF_SIMILARITY
      || quality.minSelfSimilarity < quality.calibratedThreshold
      || quality.similarityStddev > MAX_ENROLLMENT_SIMILARITY_STDDEV
    ) {
      throw new Error('speaker_enrollment_unstable_profile');
    }

    this.options.store.saveMeProfile({
      embedding,
      embeddingDim: this.options.extractor.dim,
      extractorModel: this.options.extractor.modelId,
      extractorVersion: this.options.extractor.version,
      threshold: Math.max(this.threshold, quality.calibratedThreshold),
      deviceFingerprint,
      sampleCount: samples.length,
      quality,
      nowMs: this.now(),
    });

    return this.options.store.getStatus('local');
  }
}
