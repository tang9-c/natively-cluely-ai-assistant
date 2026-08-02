import { cosineSimilarity, measureAudioQuality, normalizeL2 } from './speakerAudioUtils';
import type {
  SpeakerEmbeddingExtractorLike,
  SpeakerVerificationOutcome,
  SpeakerVerificationResult,
} from './speakerVerificationTypes';
import type { SpeakerProfileStore } from './SpeakerProfileStore';

export interface SpeakerVerificationServiceOptions {
  store: Pick<SpeakerProfileStore, 'getMeProfile'>
    & Partial<Pick<SpeakerProfileStore, 'recordVerificationStat' | 'recordVerification'>>;
  extractor: SpeakerEmbeddingExtractorLike;
}

export interface SpeakerVerificationRequestOptions {
  signal?: AbortSignal;
}

export class SpeakerVerificationService {
  constructor(private readonly options: SpeakerVerificationServiceOptions) {}

  async verify(
    samples16k: Float32Array,
    requestOptions: SpeakerVerificationRequestOptions = {},
  ): Promise<SpeakerVerificationResult> {
    const profile = this.options.store.getMeProfile();
    if (!profile) return { status: 'not_enrolled' };
    const startedAt = Date.now();

    const quality = measureAudioQuality(samples16k, undefined, { durationKind: 'verification' });
    if (!quality.ok) {
      this.recordStat('low_quality', startedAt, undefined, requestOptions.signal);
      return { status: 'low_quality', reason: quality.reason };
    }

    try {
      const embedding = normalizeL2(await this.options.extractor.extract(samples16k));
      const confidence = cosineSimilarity(embedding, profile.embedding);
      const isMe = confidence >= profile.threshold;
      this.recordStat(isMe ? 'positive' : 'low_confidence', startedAt, undefined, requestOptions.signal);
      return {
        status: 'verified',
        speakerVerification: {
          provider: 'local-speaker-verification',
          profileId: 'me',
          isMe,
          confidence,
          threshold: profile.threshold,
        },
      };
    } catch (error: any) {
      this.recordStat('error', startedAt, 'speaker_verification_failed', requestOptions.signal);
      return {
        status: 'error',
        reason: 'speaker_verification_failed',
      };
    }
  }

  recordTimeout(): void {
    this.recordStat('timeout');
  }

  recordLowQuality(): void {
    if (!this.options.store.getMeProfile()) return;
    this.recordStat('low_quality');
  }

  private recordStat(
    outcome: SpeakerVerificationOutcome,
    startedAt?: number,
    error?: string,
    signal?: AbortSignal,
  ): void {
    if (signal?.aborted) return;
    const latencyMs = startedAt === undefined ? undefined : Math.max(0, Date.now() - startedAt);
    if (this.options.store.recordVerificationStat) {
      this.options.store.recordVerificationStat({ outcome, latencyMs, error });
      return;
    }
    if (outcome === 'positive') this.options.store.recordVerification?.('verified', true);
    else if (outcome === 'low_confidence' || outcome === 'near_threshold_non_me') this.options.store.recordVerification?.('verified', false);
    else this.options.store.recordVerification?.(outcome);
  }
}
