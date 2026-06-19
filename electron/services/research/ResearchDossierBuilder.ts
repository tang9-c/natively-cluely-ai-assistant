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
  generateStructured(prompt: string, schema: z.ZodTypeAny): Promise<unknown>;
}

interface BuilderOpts { llm: LlmAdapter; }

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
  ): Promise<CompanyDossier> {
    const sources: ResearchSource[] = rawSources.map((r, i) => ({
      index: i + 1,
      title: r.title,
      url: r.url,
      snippet: r.content.slice(0, 200),
    }));
    const isFallback = sources.length === 0;
    const prompt = this.buildPrompt(companyName, sources, isFallback);

    let parsed: any;
    let lastErr: unknown = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        parsed = await this.opts.llm.generateStructured(prompt, DossierSchema);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
      }
    }
    if (lastErr) throw new LlmInvalidFormatError();
    const valid = DossierSchema.parse(parsed);

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

Respond with JSON matching the schema. For each bullet, optionally include "citation" (1-based index into the sources above).`;
  }
}