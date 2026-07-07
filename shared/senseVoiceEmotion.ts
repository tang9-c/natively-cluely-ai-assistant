export const SENSEVOICE_EMOTIONS = [
  'happy',
  'sad',
  'angry',
  'fearful',
  'disgusted',
  'surprised',
] as const;

export type TranscriptEmotion = (typeof SENSEVOICE_EMOTIONS)[number];
export type SenseVoiceEmotion = TranscriptEmotion;
export type TranscriptEmotionSource = 'sensevoice' | 'qcloud';

export const SENSEVOICE_EMOTION_LABELS: Record<TranscriptEmotion, string> = {
  happy: '开心',
  sad: '悲伤',
  angry: '愤怒',
  fearful: '害怕',
  disgusted: '厌恶',
  surprised: '惊讶',
};

export const SENSEVOICE_EMOTION_TAGS: Record<string, TranscriptEmotion | undefined> = {
  HAPPY: 'happy',
  SAD: 'sad',
  ANGRY: 'angry',
  FEARFUL: 'fearful',
  DISGUSTED: 'disgusted',
  SURPRISED: 'surprised',
  NEUTRAL: undefined,
};
