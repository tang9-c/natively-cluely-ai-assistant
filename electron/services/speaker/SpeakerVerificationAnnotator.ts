import { measureAudioQuality } from './speakerAudioUtils';
import type {
  SpeakerVerificationMetadata,
  SpeakerVerificationMode,
  SpeakerVerificationResult,
} from './speakerVerificationTypes';

export interface SpeakerVerificationAnnotatorOptions {
  getMode: () => SpeakerVerificationMode;
  service: {
    verify(samples16k: Float32Array, options?: { signal?: AbortSignal }): Promise<SpeakerVerificationResult>;
    recordLowQuality?(): void;
    recordTimeout?(): void;
  };
  timeoutMs?: number;
  onTimeout?: () => void;
}

export class SpeakerVerificationAnnotator {
  constructor(private readonly options: SpeakerVerificationAnnotatorOptions) {}

  async annotate(samples16k: Float32Array): Promise<SpeakerVerificationMetadata | undefined> {
    if (this.options.getMode() !== 'local') return undefined;
    if (!measureAudioQuality(samples16k).ok) {
      try {
        this.options.service.recordLowQuality?.();
      } catch {
        // Verification telemetry must never interrupt transcription.
      }
      return undefined;
    }
    const timeoutMs = this.options.timeoutMs ?? 200;
    const abortController = new AbortController();
    let timeout: NodeJS.Timeout | undefined;
    const timeoutResult = new Promise<undefined>((resolve) => {
      timeout = setTimeout(() => {
        abortController.abort();
        resolve(undefined);
      }, timeoutMs);
    });
    let result: SpeakerVerificationResult | undefined;
    try {
      result = await Promise.race([
        this.options.service.verify(samples16k, { signal: abortController.signal }),
        timeoutResult,
      ]);
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
    if (!result) {
      try {
        this.options.service.recordTimeout?.();
        this.options.onTimeout?.();
      } catch {
        // Verification telemetry must never interrupt transcription.
      }
      return undefined;
    }
    return result.status === 'verified' ? result.speakerVerification : undefined;
  }
}
