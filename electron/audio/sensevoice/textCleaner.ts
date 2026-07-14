import { SENSEVOICE_EMOTION_TAGS } from '../../../shared/senseVoiceEmotion';
import type { SenseVoiceEmotion } from '../../../shared/senseVoiceEmotion';

export interface ParsedSenseVoiceOutput {
  text: string;
  language?: string;
  emotion?: SenseVoiceEmotion;
  events?: string[];
}

export interface SenseVoiceHallucinationFilterOptions {
  recognitionLanguageKey?: string;
}

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

    if (upper in SENSEVOICE_EMOTION_TAGS) {
      const emotion = SENSEVOICE_EMOTION_TAGS[upper];
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

const COMMON_SHORT_HALLUCINATIONS = new Set([
  'there',
  'there.',
  'there,',
  'there!',
  'thank you.',
  'thanks.',
]);

function isChinesePreferred(key?: string): boolean {
  const normalized = (key || '').toLowerCase();
  return !normalized || normalized === 'auto' || normalized === 'chinese' || normalized.startsWith('zh');
}

function hasCjk(text: string): boolean {
  return /[\u3400-\u9fff]/.test(text);
}

function isShortLatinHallucination(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  if (COMMON_SHORT_HALLUCINATIONS.has(normalized)) return true;
  if (text.length > 24) return false;
  if (!/^[a-zA-Z\s.,!?'-]+$/.test(text)) return false;
  return normalized.split(/\s+/).filter(Boolean).length <= 3;
}

function isShortKanaOrHangul(text: string): boolean {
  const compact = text.replace(/[\s。！？!?.,，、]/g, '');
  if (!compact || compact.length > 12) return false;
  return /^[\u3040-\u30ff\uac00-\ud7af]+$/.test(compact);
}

export function shouldDropSenseVoiceHallucination(
  parsed: ParsedSenseVoiceOutput,
  options: SenseVoiceHallucinationFilterOptions = {},
): boolean {
  const text = parsed.text.trim();
  if (!text) return true;
  if (!isChinesePreferred(options.recognitionLanguageKey)) return false;
  if (hasCjk(text)) return false;

  if ((parsed.language === 'ja' || parsed.language === 'ko') && isShortKanaOrHangul(text)) return true;
  if (parsed.language === 'en' && isShortLatinHallucination(text)) return true;
  if (!parsed.language && (isShortKanaOrHangul(text) || COMMON_SHORT_HALLUCINATIONS.has(text.toLowerCase()))) return true;

  return false;
}
