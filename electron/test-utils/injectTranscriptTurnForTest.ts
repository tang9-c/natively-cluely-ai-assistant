// electron/test-utils/injectTranscriptTurnForTest.ts
// Test-only helper for forwarding transcript turns to the IntentClassifier
// from the `inject-transcript-turn` IPC channel. Only registered when
// NODE_ENV === 'test'.

/**
 * 测试用：把 transcript turn 推到 IntentClassifier，触发分类。
 * 仅在 NODE_ENV=test 下注册。
 */
export async function injectTranscriptTurnForTest(turn: {
  speaker: string;
  text: string;
  startMs: number;
  endMs: number;
}): Promise<{ ok: boolean; lastIntent?: string }> {
  const classifier = (globalThis as any).__intentClassifier as
    | { classify: (text: string, speaker: string) => Promise<{ intent: string } | null> }
    | undefined;
  if (!classifier) return { ok: false };
  const result = await classifier.classify(turn.text, turn.speaker);
  (globalThis as any).__lastIntentResult = result?.intent ?? null;
  return { ok: true, lastIntent: result?.intent };
}