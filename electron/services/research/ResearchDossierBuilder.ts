// electron/services/research/ResearchDossierBuilder.ts
import { z } from 'zod';
import type {
  CompanyDossier, ResearchDimension, ResearchSource,
} from './types';
import { DOSSIER_SCHEMA_VERSION } from './types';

export class LlmInvalidFormatError extends Error {
  constructor(message = 'LLM returned invalid dossier shape') {
    super(message);
    this.name = 'LlmInvalidFormatError';
  }
}

export interface LlmAdapter {
  generateStructured(
    prompt: string,
    schema: z.ZodTypeAny,
    options?: {
      taskLabel?: string;
      perProviderTimeoutMs?: number;
      maxOutputTokens?: number;
      maxRotations?: number;
    },
  ): Promise<unknown>;
}

interface BuilderOpts {
  llm: LlmAdapter;
  /**
   * Optional callback fired before each LLM attempt (1-based, up to 2 attempts).
   * Used by CompanyResearchEngine to surface progress events during synthesis
   * so the UI is not silent while the LLM is being polled.
   */
  onAttempt?: (attempt: number) => void;
}

const BulletSchema = z.object({
  text: z.string(),
  citation: z.number().int().positive().optional(),
});

const DimensionSchema = z.object({
  summary: z.string(),
  details: z.array(BulletSchema),
  confidence: z.enum(['high', 'medium', 'low']),
});

const SourceSchema = z.object({
  index: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  snippet: z.string().max(500),
});

const DossierSchema = z.object({
  schemaVersion: z.literal('1.0'),
  companyName: z.string(),
  financials: DimensionSchema,
  business: DimensionSchema,
  strategy: DimensionSchema,
  people: DimensionSchema,
  infrastructure: DimensionSchema,
  procurement: DimensionSchema,
  sources: z.array(SourceSchema),
});

export class ResearchDossierBuilder {
  constructor(private readonly opts: BuilderOpts) {}

  async build(
    companyName: string,
    rawSources: Array<{ title: string; url: string; content: string }>,
    opts?: { onAttempt?: (attempt: number) => void },
  ): Promise<CompanyDossier> {
    const sources: ResearchSource[] = rawSources.map((r, i) => ({
      index: i + 1,
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 200),
    }));
    const isFallback = sources.length === 0;
    const prompt = this.buildPrompt(companyName, sources, isFallback);

    // Per-call opts.onAttempt takes precedence over the constructor-provided one,
    // so callers (e.g. CompanyResearchEngine) can inject a forwarder without
    // rebuilding the builder.
    const onAttempt = opts?.onAttempt ?? this.opts.onAttempt;

    let parsed: any;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      onAttempt?.(attempt + 1); // 1-based: 1, then 2
      try {
        const raw = await this.opts.llm.generateStructured(prompt, DossierSchema, {
          taskLabel: 'company-research',
          perProviderTimeoutMs: 35_000,
          // Reduced from 8_192 → 2_048 (debug session 2026-06-21): 8K ceiling
          // forced the model to consume the entire token budget generating filler,
          // never producing a valid JSON dossier within the 35s timeout. Actual
          // 6-dimension dossier fits in ~1,100 tokens; 2_048 leaves headroom.
          maxOutputTokens: 2_048,
          maxRotations: 1,
        });
        parsed = DossierSchema.parse(parseStructuredPayload(raw));
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw new LlmInvalidFormatError(formatZodError(lastErr));
    const valid = parsed;

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return {
      schemaVersion: DOSSIER_SCHEMA_VERSION,
      companyName: valid.companyName || companyName,
      generatedAt: now,
      expiresAt: expires,
      source: isFallback ? 'llm-fallback' : 'tavily',
      financials: this.maybeDowngrade(valid.financials, isFallback),
      business: this.maybeDowngrade(valid.business, isFallback),
      strategy: this.maybeDowngrade(valid.strategy, isFallback),
      people: this.maybeDowngrade(valid.people, isFallback),
      infrastructure: this.maybeDowngrade(valid.infrastructure, isFallback),
      procurement: this.maybeDowngrade(valid.procurement, isFallback),
      sources: isFallback ? [] : valid.sources,
    };
  }

  private maybeDowngrade(dim: ResearchDimension, isFallback: boolean): ResearchDimension {
    if (!isFallback) return dim;
    return { ...dim, confidence: 'low' as const };
  }

  private buildPrompt(
    companyName: string,
    sources: ResearchSource[],
    isFallback: boolean,
  ): string {
    const sourceBlock = sources.length === 0
      ? '(no external sources — use your training knowledge, mark all confidence as "low")'
      : sources.map((s) => `[${s.index}] ${s.title} — ${s.url}\n${s.snippet}`).join('\n\n');
    return `You are a company research analyst. Produce a 6-dimension dossier for "${companyName}".

Dimensions (each must have summary + 3-7 bullets + confidence):
1. financials — size, revenue, growth, R&D
2. business — products, customers, target markets
3. strategy — expansion plans, hiring hotspots, transformation
4. people — executives, department heads, key org structure
5. infrastructure — tech stack, supply chain, digital ecosystem
6. procurement — past purchase records, supplier compliance requirements

${isFallback ? '⚠️ No external sources available. Answer from training knowledge only.' : ''}

Sources:
${sourceBlock}

Respond with JSON matching the schema. For each bullet, optionally include "citation" (1-based index into the sources above). Every "url" in sources must be a valid HTTP/HTTPS URL. Do not invent URLs; only use the URLs provided above.`;
  }
}

function formatZodError(err: unknown): string {
  if (err instanceof z.ZodError) {
    const issues = err.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    return `LLM returned invalid dossier shape (${issues})`;
  }
  if (err instanceof SyntaxError) {
    return `LLM returned invalid dossier JSON (${err.message})`;
  }
  if (err instanceof Error && err.message) {
    return `LLM returned invalid dossier shape (${err.message})`;
  }
  return 'LLM returned invalid dossier shape';
}

function parseStructuredPayload(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;

  const cleaned = stripMarkdownFence(raw.trim());
  try {
    return JSON.parse(cleaned);
  } catch (directErr) {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) throw directErr;
    return JSON.parse(extracted);
  }
}

function stripMarkdownFence(text: string): string {
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenceMatch ? fenceMatch[1].trim() : text;
}

function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}
