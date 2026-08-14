export type QCloudRequestClass =
  | 'realtime_answer'
  | 'dynamic_action'
  | 'meeting_summary'
  | 'post_call';

export const QCLOUD_INPUT_TOKEN_BUDGETS: Readonly<Record<QCloudRequestClass, number>> = {
  realtime_answer: 3_000,
  dynamic_action: 2_000,
  meeting_summary: 12_000,
  post_call: 6_000,
};

// Leaves headroom inside the 12K summary input budget for XML boundaries,
// mode context, and the required response schema that accompany each chunk.
export const QCLOUD_MEETING_SUMMARY_SAFE_CHUNK_CHARS = 10_000;

export const QCLOUD_TIMEOUT_POLICIES: Readonly<Record<QCloudRequestClass, {
  firstTokenMs: number;
  idleMs: number;
  totalMs: number;
}>> = {
  realtime_answer: { firstTokenMs: 12_000, idleMs: 5_000, totalMs: 30_000 },
  dynamic_action: { firstTokenMs: 6_000, idleMs: 5_000, totalMs: 6_000 },
  meeting_summary: { firstTokenMs: 60_000, idleMs: 15_000, totalMs: 60_000 },
  post_call: { firstTokenMs: 60_000, idleMs: 15_000, totalMs: 60_000 },
};

export interface QCloudInputBudgetResult {
  text: string;
  originalEstimatedTokens: number;
  estimatedTokens: number;
  truncated: boolean;
}

export interface QCloudUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
}

const TRUNCATION_MARKER = '\n[...older context truncated...]\n';

export function estimateQCloudInputTokens(text: string): number {
  if (!text) return 0;
  let cjkChars = 0;
  let otherChars = 0;
  for (const character of text) {
    if (/\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}/u.test(character)) {
      cjkChars += 1;
    } else {
      otherChars += 1;
    }
  }
  return cjkChars + Math.ceil(otherChars / 4);
}

export function applyQCloudInputBudget(
  text: string,
  requestClass?: QCloudRequestClass,
): QCloudInputBudgetResult {
  const originalEstimatedTokens = estimateQCloudInputTokens(text);
  if (!requestClass) {
    return { text, originalEstimatedTokens, estimatedTokens: originalEstimatedTokens, truncated: false };
  }

  const tokenBudget = QCLOUD_INPUT_TOKEN_BUDGETS[requestClass];
  if (originalEstimatedTokens <= tokenBudget) {
    return { text, originalEstimatedTokens, estimatedTokens: originalEstimatedTokens, truncated: false };
  }

  const buildCandidate = (contentChars: number) => {
    const prefixChars = Math.floor(contentChars * 0.2);
    const suffixChars = contentChars - prefixChars;
    return `${text.slice(0, prefixChars)}${TRUNCATION_MARKER}${text.slice(-suffixChars)}`;
  };
  let low = 0;
  let high = text.length;
  let boundedText = TRUNCATION_MARKER;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = buildCandidate(middle);
    if (estimateQCloudInputTokens(candidate) <= tokenBudget) {
      boundedText = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return {
    text: boundedText,
    originalEstimatedTokens,
    estimatedTokens: estimateQCloudInputTokens(boundedText),
    truncated: true,
  };
}

export function readQCloudUsage(payload: unknown): QCloudUsageMetrics | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const usage = (payload as { usage?: unknown }).usage;
  if (!usage || typeof usage !== 'object') return undefined;
  const record = usage as Record<string, unknown>;
  const details = record.prompt_tokens_details && typeof record.prompt_tokens_details === 'object'
    ? record.prompt_tokens_details as Record<string, unknown>
    : undefined;
  const numberOrUndefined = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
  return {
    inputTokens: numberOrUndefined(record.prompt_tokens ?? record.input_tokens),
    outputTokens: numberOrUndefined(record.completion_tokens ?? record.output_tokens),
    totalTokens: numberOrUndefined(record.total_tokens),
    cachedInputTokens: numberOrUndefined(details?.cached_tokens ?? record.cache_read_input_tokens),
  };
}
