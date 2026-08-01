import type {
  SpeakerVerificationMetadata,
  SpeakerVerificationMode,
  SpeakerVerificationResult,
} from './speakerVerificationTypes';

export interface SpeakerVerificationAnnotatorOptions {
  getMode: () => SpeakerVerificationMode;
  service: {
    verify(samples16k: Float32Array): Promise<SpeakerVerificationResult>;
  };
}

export class SpeakerVerificationAnnotator {
  constructor(private readonly options: SpeakerVerificationAnnotatorOptions) {}

  async annotate(samples16k: Float32Array): Promise<SpeakerVerificationMetadata | undefined> {
    if (this.options.getMode() !== 'local') return undefined;
    const result = await this.options.service.verify(samples16k);
    return result.status === 'verified' ? result.speakerVerification : undefined;
  }
}
