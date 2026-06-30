import {
  meanEmbedding,
  measureAudioQuality,
  resampleFloat32To16k,
  slidingWindows,
} from './speakerAudioUtils';
import type {
  EnrollmentAudioSample,
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

export class SpeakerEnrollmentService {
  private readonly threshold: number;
  private readonly now: () => number;

  constructor(private readonly options: SpeakerEnrollmentServiceOptions) {
    this.threshold = options.threshold ?? 0.72;
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
    this.options.store.saveMeProfile({
      embedding,
      embeddingDim: this.options.extractor.dim,
      extractorModel: this.options.extractor.modelId,
      extractorVersion: this.options.extractor.version,
      threshold: this.threshold,
      deviceFingerprint,
      sampleCount: samples.length,
      nowMs: this.now(),
    });

    return this.options.store.getStatus('local');
  }
}
