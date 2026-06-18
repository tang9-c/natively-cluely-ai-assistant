export type SenseVoiceEmotion =
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'disgusted'
  | 'surprised';

export interface ParsedSenseVoiceOutput {
  text: string;
  language?: string;
  emotion?: SenseVoiceEmotion;
  events?: string[];
}

const EMOTION_TAGS: Record<string, SenseVoiceEmotion | undefined> = {
  HAPPY: 'happy',
  SAD: 'sad',
  ANGRY: 'angry',
  FEARFUL: 'fearful',
  DISGUSTED: 'disgusted',
  SURPRISED: 'surprised',
  NEUTRAL: undefined,
};

const LANGUAGE_TAGS = new Set(['zh', 'en', 'ja', 'ko', 'yue']);

/**
 * SenseVoice may prefix text with tags such as <|zh|>, <|NEUTRAL|>,
 * <|Speech|>. Parse useful metadata while keeping transcript storage/UI clean.
 */
export function parseSenseVoiceOutput(rawText: string): ParsedSenseVoiceOutput {
  const source = rawText ?? '';
  const tags = Array.from(source.matchAll(/<\|([^|>]+)\|>/g), match => match[1]);
  const parsed: ParsedSenseVoiceOutput = {
    text: source
      .replace(/<\|[^|>]+\|>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  };
  const events: string[] = [];

  for (const tag of tags) {
    const normalized = tag.trim();
    if (!normalized || normalized.startsWith('/')) continue;

    const lower = normalized.toLowerCase();
    const upper = normalized.toUpperCase();

    if (!parsed.language && LANGUAGE_TAGS.has(lower)) {
      parsed.language = lower;
      continue;
    }

    if (upper in EMOTION_TAGS) {
      const emotion = EMOTION_TAGS[upper];
      if (emotion) parsed.emotion = emotion;
      continue;
    }

    events.push(lower);
  }

  if (events.length > 0) {
    parsed.events = Array.from(new Set(events));
  }

  return parsed;
}

export function cleanSenseVoiceText(text: string): string {
  return parseSenseVoiceOutput(text).text;
}
