import { cosineSimilarity, measureAudioQuality, normalizeL2 } from './speakerAudioUtils';
import type {
  SpeakerEmbeddingExtractorLike,
  SpeakerVerificationResult,
} from './speakerVerificationTypes';
import type { SpeakerProfileStore } from './SpeakerProfileStore';

export interface SpeakerVerificationServiceOptions {
  store: Pick<SpeakerProfileStore, 'getMeProfile'>;
  extractor: SpeakerEmbeddingExtractorLike;
}

export class SpeakerVerificationService {
  constructor(private readonly options: SpeakerVerificationServiceOptions) {}

  async verify(samples16k: Float32Array): Promise<SpeakerVerificationResult> {
    const profile = this.options.store.getMeProfile();
    if (!profile) return { status: 'not_enrolled' };

    const quality = measureAudioQuality(samples16k);
    if (!quality.ok) {
      return { status: 'low_quality', reason: quality.reason };
    }

    try {
      const embedding = normalizeL2(await this.options.extractor.extract(samples16k));
      const confidence = cosineSimilarity(embedding, profile.embedding);
      return {
        status: 'verified',
        speakerVerification: {
          provider: 'local-speaker-verification',
          profileId: 'me',
          isMe: confidence >= profile.threshold,
          confidence,
          threshold: profile.threshold,
        },
      };
    } catch (error: any) {
      return {
        status: 'error',
        reason: error?.message ?? String(error),
      };
    }
  }
}
