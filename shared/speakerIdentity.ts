export interface SpeakerIdentityCorrection {
  isMe: boolean;
  source: 'user';
  correctedAt: number;
}

export interface SpeakerIdentitySegmentLike {
  speaker: string;
  speakerIdentityCorrection?: SpeakerIdentityCorrection;
}

export function resolveEffectiveSpeaker(segment: SpeakerIdentitySegmentLike): string {
  const correction = segment.speakerIdentityCorrection;
  if (!correction || typeof correction.isMe !== 'boolean') return segment.speaker;
  return correction.isMe ? 'user' : 'interviewer';
}
