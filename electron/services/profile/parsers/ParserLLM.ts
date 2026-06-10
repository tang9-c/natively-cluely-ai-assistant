const PARSE_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
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

  async parse<T>(prompt: string, schemaDescription: string): Promise<T> {
    const systemHint =
      'Respond with valid JSON and nothing else. Do not wrap the output in markdown code fences.';
    const fullPrompt = `${prompt}\n\n${schemaDescription}\n\n${systemHint}`;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const promptForAttempt =
        attempt > 0
          ? `${fullPrompt}\n\nYour previous response was not valid JSON. Please return ONLY a JSON object.`
          : fullPrompt;

      try {
        const raw = await withTimeout(
          this.llmHelper.generateContentStructured(promptForAttempt),
          PARSE_TIMEOUT_MS,
          'ParserLLM',
        );
        const candidate = extractJsonObject(raw);
        const parsed = JSON.parse(candidate) as T;
        return parsed;
      } catch (err: any) {
        lastError = err;
      }
    }

    throw lastError ?? new Error('Could not parse structured response from LLM');
  }
}
