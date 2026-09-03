import type { ProviderDataScope } from '../../../llm/ProviderRouter';

function getParseTimeoutMs(): number {
  return Number(process.env.NATIVELY_PARSER_TIMEOUT_MS ?? 60_000);
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (process.env.NATIVELY_PARSER_TIMEOUT_UNREF !== '0' && typeof (t as any).unref === 'function') {
        (t as any).unref();
      }
    }),
  ]);
}

function extractJsonObject(raw: string): string {
  const cleaned = raw
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }
  return cleaned;
}

export class ParserLLM {
  constructor(private llmHelper: any) {}

  async parse<T>(
    prompt: string,
    schemaDescription: string,
    dataScopes: ProviderDataScope[],
  ): Promise<T> {
    const systemHint =
      'Respond with valid JSON and nothing else. Do not wrap the output in markdown code fences.';
    const fullPrompt = `${prompt}\n\n${schemaDescription}\n\n${systemHint}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const promptForAttempt =
        attempt > 0
          ? `${fullPrompt}\n\nCRITICAL: Your previous response was empty or invalid. You MUST extract actual data from the provided text above. Do NOT return empty arrays or blank strings. Fill every field with real information found in the text.`
          : fullPrompt;

      try {
        const raw: string = await withTimeout(
          this.llmHelper.generateContentStructured(promptForAttempt, { dataScopes }),
          getParseTimeoutMs(),
          'ParserLLM',
        );
        console.log('[ParserLLM] Raw response length:', raw.length);
        const candidate = extractJsonObject(raw);
        const parsed = JSON.parse(candidate) as T;
        return parsed;
      } catch (err: any) {
        if (err?.name === 'ProviderScopeError') {
          throw err;
        }
        console.warn('[ParserLLM] Attempt', attempt + 1, 'failed:', err.message);
        lastError = err;
      }
    }

    throw lastError ?? new Error('Could not parse structured response from LLM');
  }
}
