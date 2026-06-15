/**
 * SenseVoice may prefix text with tags such as <|zh|>, <|NEUTRAL|>,
 * <|Speech|>. Keep transcript storage/UI clean by stripping those markers.
 */
export function cleanSenseVoiceText(text: string): string {
  return (text ?? '')
    .replace(/<\|[^|>]+\|>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
