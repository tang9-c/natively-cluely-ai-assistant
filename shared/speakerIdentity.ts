export interface SpeakerIdentityCorrection {
  isMe?: boolean;
  identity?: 'me' | 'other' | 'unknown';
  source: 'user';
  correctedAt: number;
}

export interface SpeakerIdentitySegmentLike {
  speaker?: string;
  role?: string;
  speakerIdentityCorrection?: SpeakerIdentityCorrection;
  speakerVerification?: { provider?: string; profileId?: string; isMe?: boolean; confidence?: number; threshold?: number };
  providerSpeakerId?: string;
  diarizationProvider?: string;
  coalescedFromCount?: number;
  rawSegmentIds?: string[];
  multipleSpeakers?: boolean;
}

export interface SpeakerIdentity {
  identity: 'me' | 'other' | 'unknown' | 'numbered';
  label: string;
  source: 'manual' | 'voice' | 'provider' | 'unknown';
  detail: string;
}

export function resolveSpeakerIdentity(segment: SpeakerIdentitySegmentLike): SpeakerIdentity {
  const correction = segment.speakerIdentityCorrection;
  if (correction?.source === 'user') {
    const identity = correction.identity ?? (typeof correction.isMe === 'boolean' ? correction.isMe ? 'me' : 'other' : undefined);
    if (identity === 'me') return { identity, label: '我', source: 'manual', detail: '已确认' };
    if (identity === 'other') return { identity, label: '其他参会者', source: 'manual', detail: '已确认非本人；不代表与其他片段为同一人' };
    if (identity === 'unknown') return { identity, label: '身份未确认', source: 'manual', detail: '人工标记为未确认' };
  }
  const voice = segment.speakerVerification;
  const singleUnit = !(segment.coalescedFromCount && segment.coalescedFromCount > 1)
    && (segment.rawSegmentIds?.length ?? 0) <= 1 && !segment.multipleSpeakers;
  if (singleUnit && voice?.provider === 'local-speaker-verification' && voice.profileId === 'me'
    && voice.isMe === true && Number.isFinite(voice.confidence) && Number.isFinite(voice.threshold)
    && voice.threshold! >= 0 && voice.threshold! <= 1 && voice.confidence! <= 1
    && voice.confidence! >= voice.threshold!) {
    return { identity: 'me', label: '我', source: 'voice', detail: '声纹匹配；相似度不代表身份正确率' };
  }
  const id = typeof segment.providerSpeakerId === 'string' ? segment.providerSpeakerId.trim() : undefined;
  if (['doubao-auc', 'qcloud'].includes(segment.diarizationProvider ?? '') && id && /^(?:speaker[-_])?\d+$/i.test(id)) {
    return { identity: 'numbered', label: `说话人 ${id.replace(/^speaker[-_]/i, '')}`, source: 'provider', detail: '提供商说话人编号；不代表真实姓名' };
  }
  return { identity: 'unknown', label: '身份未确认', source: 'unknown', detail: '音源不能确定人物身份' };
}

/** Compatibility adapter for role-based consumers; capture routing must use the original speaker. */
export function resolveEffectiveSpeaker(segment: SpeakerIdentitySegmentLike): string {
  if (['assistant', 'ai', 'model', 'system'].includes(segment.speaker ?? segment.role ?? '')) return segment.speaker ?? segment.role!;
  const { identity } = resolveSpeakerIdentity(segment);
  return identity === 'me' ? 'user' : identity === 'other' ? 'interviewer' : 'unknown';
}

export const SPEAKER_ATTRIBUTION_RULES = '音源通道不代表人物身份。身份未确认或仅有说话人编号的发言中，“我来做”等第一人称承诺的负责人必须待确认，不得归给用户；原文明确提到姓名时可按原话提取。不同“其他参会者”片段不保证是同一人。';

export function speakerIdentityPromptLabel(segment: SpeakerIdentitySegmentLike): string {
  if (['assistant', 'ai', 'model'].includes(segment.speaker ?? segment.role ?? '')) return 'ASSISTANT';
  const resolved = resolveSpeakerIdentity(segment);
  return resolved.identity === 'me' ? 'ME' : resolved.label;
}
