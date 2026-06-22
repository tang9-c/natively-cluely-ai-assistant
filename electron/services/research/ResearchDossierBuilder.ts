// electron/services/research/ResearchDossierBuilder.ts
import { app } from 'electron';
import { z } from 'zod';
import type {
  CompanyDossier, ResearchDimension, ResearchSource,
} from './types';
import { DOSSIER_SCHEMA_VERSION } from './types';

/**
 * Emit a one-line structured log for a research-pipeline stage.
 * Format: `[Research] stage=<name> <key>=<value> ...`
 * No-op when packaged (production). Do NOT pass raw LLM content here.
 *
 * `app.isPackaged` is read lazily inside the helper (not at module load) so
 * tests running under ELECTRON_RUN_AS_NODE — where the `electron` module
 * exports a stub without a real `app` — do not crash on import. When `app`
 * is unavailable (test-only), we treat the environment as dev and emit.
 */
function researchLog(stage: string, fields: Record<string, unknown>): void {
  if (app?.isPackaged) return;
  const flat = Object.entries(fields)
    .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
    .join(' ');
  console.log(`[Research] stage=${stage} ${flat}`);
}

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
  // .nullish() = .nullable().optional(): accept positive int, null, or absent.
  // LLM emits `citation: null` when it has no source to cite; .optional() rejected that.
  citation: z.number().int().positive().nullish(),
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
    const buildStartedAt = Date.now();
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
        const llmStartedAt = Date.now();
        const raw = await this.opts.llm.generateStructured(prompt, DossierSchema, {
          taskLabel: 'company-research',
          // Raised 45_000 → 90_000 (debug session 2026-06-22, follow-up): user
          // observed random timeouts where the LLM call took 45-90s. 90s gives
          // 30-60s headroom over the slow end without making a hung request block
          // forever. Synthesis budget (120s) accommodates one 90s call + buffer;
          // the smart retry still skips attempt 2 on timeout (no second 90s wait).
          perProviderTimeoutMs: 90_000,
          // Token budget history (debug sessions 2026-06-21 / 2026-06-22):
          //   8_192 → reduced to 2_048 on 2026-06-21 because the 8K ceiling
          //     forced the model to consume the entire token budget generating
          //     filler, never producing a valid JSON dossier within the 35s
          //     timeout.
          //   2_048 → raised to 4_096 on 2026-06-22 because the model is now
          //     producing real content (not filler): 安克创新 dossier was 4,900+
          //     characters (~1,800-2,000 tokens) on first attempt, pushing past
          //     the 2_048 ceiling and causing JSON.parse failures with messages
          //     like "Unterminated string in JSON at position 4899". The two
          //     attempts failed at different positions (4899 / 5160) because
          //     the LLM produces variable-length output and gets cut off at
          //     the 2,048-token wall each time. Historical baseline (TEMP
          //     DEBUG logs) showed successful parses at raw_len 3,558 / 3,719 /
          //     4,625 chars (~1,300-1,700 tokens). 4_096 provides headroom for
          //     the real-world upper bound observed today while still bounded
          //     well below the 8K failure ceiling. Do NOT raise back to 8_192.
          maxOutputTokens: 4_096,
          maxRotations: 1,
        });
        researchLog('llm-call', {
          attempt: attempt + 1,
          provider: 'Doubao Pro (doubao-1-5-pro-32k-250115)',
          promptChars: prompt.length,
          maxTokens: 4_096,
          durationMs: Date.now() - llmStartedAt,
          result: 'success',
        });
        // Normalize LLM output before schema validation. Real samples from
        // debug session 2026-06-22 (Doubao Pro on a Chinese prompt) show two
        // consistent deviations from the documented schema:
        //   1. `bullets` (noun) instead of `details` — the prompt uses
        //      "3-7 bullets" and the model names the field accordingly.
        //   2. confidence in Chinese (高/中/低) instead of the enum
        //      ('high'|'medium'|'low') — the prompt is Chinese and the model
        //      mirrors the prompt's language.
        // normalizeDossier fixes both, plus injects schemaVersion and
        // companyName when the model omits them (it currently does for both).
        const { normalized, rules } = normalizeDossier(parseStructuredPayload(raw), companyName);
        researchLog('normalize', { attempt: attempt + 1, rules: rules.length ? rules : '(none)' });
        parsed = DossierSchema.parse(normalized);
        lastErr = null;
        break;
      } catch (err) {
        researchLog('llm-call', {
          attempt: attempt + 1,
          provider: 'Doubao Pro (doubao-1-5-pro-32k-250115)',
          promptChars: prompt.length,
          maxTokens: 4_096,
          result: isTimeoutError(err) ? 'timeout' : 'error',
          failure: (err as Error)?.message ?? String(err),
        });
        lastErr = err;
        // Smart retry (debug session 2026-06-22): if attempt 1 timed out,
        // the underlying cause is provider slowness and retrying just burns
        // another full per-provider timeout — observed 45s + 45s = 90s of
        // waiting for the same outcome. Surface LLM_TIMEOUT immediately.
        // Non-timeout errors (schema, network, etc.) still retry because
        // they're more likely to be transient or prompt-tweakable.
        if (isTimeoutError(err)) {
          break;
        }
      }
    }
    researchLog('build', {
      result: lastErr ? 'failure' : 'success',
      dimensions: lastErr ? '0/6' : '6/6',
      durationMs: Date.now() - buildStartedAt,
    });
    if (lastErr) throw new LlmInvalidFormatError(formatZodError(lastErr));
    const valid = parsed;

    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    return {
      schemaVersion: DOSSIER_SCHEMA_VERSION,
      companyName: valid.companyName || companyName,
      generatedAt: now,
      expiresAt: expires,
      // source reflects what actually produced the dossier: 'tavily' only
      // if Tavily returned sources AND the LLM echoed them back in the
      // normalized dossier. If LLM omits sources, the dossier is effectively
      // an LLM-only synthesis regardless of whether Tavily was consulted.
      source: isFallback || valid.sources.length === 0 ? 'llm-fallback' : 'tavily',
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

Dimensions (each must have summary + 3-5 bullets + confidence):
1. financials — size, revenue, growth, R&D
2. business — products, customers, target markets
3. strategy — expansion plans, hiring hotspots, transformation
4. people — executives, department heads, key org structure
5. infrastructure — tech stack, supply chain, digital ecosystem
6. procurement — past purchase records, supplier compliance requirements

${isFallback ? '⚠️ No external sources available. Answer from training knowledge only.' : ''}

Sources:
${sourceBlock}

Respond with JSON matching the schema EXACTLY. Required structure:

{
  "schemaVersion": "1.0",
  "companyName": "${companyName}",
  "financials":    { "summary": "...", "details": [...], "confidence": "high" },
  "business":       { "summary": "...", "details": [...], "confidence": "high" },
  "strategy":       { "summary": "...", "details": [...], "confidence": "high" },
  "people":         { "summary": "...", "details": [...], "confidence": "high" },
  "infrastructure": { "summary": "...", "details": [...], "confidence": "high" },
  "procurement":    { "summary": "...", "details": [...], "confidence": "high" },
  "sources":        [ { "index": 1, "title": "...", "url": "https://...", "snippet": "..." } ]
}

Field rules — these are STRICT, the schema validation will reject mismatches:
- Each bullet array MUST be named "details" (NOT "bullets" / "items" / "points").
- Each "confidence" MUST be exactly one of: "high", "medium", "low" (lowercase English).
- "details" entries MUST be { "text": string, "citation"?: number }.
- Include the top-level "schemaVersion" and "companyName" fields above.
- Every "url" in sources must be a valid HTTP/HTTPS URL. Do not invent URLs.`;
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

// Map of Chinese confidence words to the schema's English enum values.
const CONFIDENCE_ZH_TO_ENUM: Record<string, 'high' | 'medium' | 'low'> = {
  高: 'high',
  中: 'medium',
  低: 'low',
};

function normalizeConfidence(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  const lower = trimmed.toLowerCase();
  // Accept valid enum values, with any casing — debug session 2026-06-22
  // saw "Low" / "HIGH" / "Medium" from the same model in adjacent runs.
  if (lower === 'high' || lower === 'medium' || lower === 'low') return lower;
  return CONFIDENCE_ZH_TO_ENUM[trimmed] ?? value;
}

function normalizeBullets(arr: unknown): unknown[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((item) => {
    if (typeof item === 'string') return { text: item };
    if (item && typeof item === 'object') {
      const obj = { ...(item as Record<string, unknown>) };
      if (obj.citation === null) {
        delete obj.citation; // null becomes undefined for Zod (which now allows both)
      }
      return obj;
    }
    return { text: String(item) };
  });
}

function normalizeDimension(dim: unknown): unknown {
  if (!dim || typeof dim !== 'object') return dim;
  const obj = { ...(dim as Record<string, unknown>) };
  // Alias: LLM (Doubao on Chinese prompts) emits `bullets` for the array of
  // bullet points. Keep `details` if the model already used it.
  const bulletsArr = Array.isArray(obj.details) ? obj.details : obj.bullets;
  if (!Array.isArray(obj.details) && Array.isArray(obj.bullets)) {
    delete obj.bullets;
  }
  obj.details = normalizeBullets(bulletsArr);
  obj.confidence = normalizeConfidence(obj.confidence);
  return obj;
}

// Canonical dimension keys in the order the prompt lists them.
const DIMENSION_KEYS = ['financials', 'business', 'strategy', 'people', 'infrastructure', 'procurement'] as const;

/**
 * Recognise a per-provider timeout so the builder can skip retry on attempt 1
 * (debug session 2026-06-22). LLMHelper formats timeout errors as
 * `<provider.name> <taskLabel> structured generation timed out after <N>ms`
 * (see `LLMHelper.withTimeout`). Match that exact substring — looser patterns
 * like `/(?:^|\s)timed?\s*out/i` false-positive on user content ("non timeout")
 * and on unrelated network errors ("request timeout exceeded"), causing the
 * builder to skip retry and surface LLM_TIMEOUT when a retry could have worked.
 */
function isTimeoutError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  return /\bstructured generation timed out after \d+ms\b/i.test(msg);
}

/**
 * Unwrap the `{ company, dimensions: [{name, summary, bullets, confidence}] }`
 * shape the model sometimes emits on retry. The retry run is non-deterministic
 * (debug session 2026-06-22, third sample), so we recognize this layout by
 * its structural signature rather than relying on the prompt alone.
 */
function unwrapDimensionsWrapper(parsed: Record<string, unknown>): Record<string, unknown> {
  const dims = parsed.dimensions;
  if (!Array.isArray(dims)) return parsed;
  const out: Record<string, unknown> = { ...parsed };
  delete out.dimensions;
  for (const dim of dims) {
    if (!dim || typeof dim !== 'object') continue;
    const name = (dim as Record<string, unknown>).name;
    if (typeof name === 'string' && (DIMENSION_KEYS as readonly string[]).includes(name)) {
      // Strip the `name` field — the canonical layout uses the dimension key
      // directly as the property name on the top-level object.
      const { name: _unused, ...rest } = dim as Record<string, unknown>;
      out[name] = rest;
    }
  }
  return out;
}

/**
 * Normalize an LLM-emitted dossier payload before schema validation.
 *
 * Deviations observed in production (debug session 2026-06-22, Doubao Pro):
 *  1. The model uses `bullets` instead of `details` for the bullet array.
 *  2. The bullets array is sometimes `string[]` instead of `{text,...}[]`.
 *  3. Confidence arrives as Chinese (高/中/低) or in mixed case ("Low").
 *  4. On retry, the model emits a wrapper shape:
 *     `{ company, dimensions: [{ name, summary, bullets, confidence }, ...] }`.
 *  5. The model often omits top-level `schemaVersion` and `companyName`.
 *
 * Each rule is regression-tested; this is the single source of truth.
 */
function normalizeDossier(parsed: unknown, fallbackCompanyName: string): { normalized: unknown; rules: string[] } {
  const rules: string[] = [];
  if (!parsed || typeof parsed !== 'object') {
    return { normalized: parsed, rules };
  }
  let out = { ...(parsed as Record<string, unknown>) };
  // Detect and unwrap the {company, dimensions:[...]} wrapper shape.
  if (Array.isArray(out.dimensions)) {
    out = unwrapDimensionsWrapper(out);
    rules.push('wrapper-unwrap');
  }
  for (const key of DIMENSION_KEYS) {
    if (!(key in out)) continue;
    const before = out[key];
    const after = normalizeDimension(before as unknown);
    out[key] = after;
    // Inspect the before/after to record which rules fired on this dimension.
    const bObj = before && typeof before === 'object' ? (before as Record<string, unknown>) : null;
    const aObj = after && typeof after === 'object' ? (after as Record<string, unknown>) : null;
    if (bObj && aObj) {
      if (Array.isArray(bObj.bullets) && Array.isArray(aObj.details) && !Array.isArray(bObj.details)) {
        rules.push('bullets→details');
      }
      if (Array.isArray(bObj.bullets) && Array.isArray(aObj.details)) {
        const firstBullet = bObj.bullets[0];
        if (typeof firstBullet === 'string') rules.push('string-array-wrap');
      }
      if (typeof bObj.confidence === 'string' && typeof aObj.confidence === 'string' && bObj.confidence !== aObj.confidence) {
        rules.push('zh-confidence→enum');
      }
      if (typeof bObj.confidence === 'string' && bObj.confidence !== bObj.confidence.toLowerCase()
          && aObj.confidence === bObj.confidence.toLowerCase()) {
        rules.push('case-normalize');
      }
      // Detect `citation: null` → undefined normalization. If any bullet in the
      // before-snapshot had a null citation and the after-snapshot does not
      // (because normalizeBullets deleted it), record the rule exactly once
      // for this dimension. Compare at the bullet level so multiple null
      // citations on one dimension still log the rule once.
      if (Array.isArray(bObj.details) && Array.isArray(aObj.details)) {
        const hadNullCitation = bObj.details.some(
          (b) => b && typeof b === 'object' && (b as Record<string, unknown>).citation === null,
        );
        const stillHasNullCitation = aObj.details.some(
          (a) => a && typeof a === 'object' && (a as Record<string, unknown>).citation === null,
        );
        if (hadNullCitation && !stillHasNullCitation) {
          rules.push('null-citation→undefined');
        }
      }
    }
  }
  if (typeof out.schemaVersion !== 'string') {
    out.schemaVersion = DOSSIER_SCHEMA_VERSION;
    rules.push('inject-schemaVersion');
  }
  if (typeof out.companyName !== 'string' || !out.companyName) {
    out.companyName = fallbackCompanyName;
    rules.push('inject-companyName');
  }
  if (!Array.isArray(out.sources)) {
    out.sources = [];
    rules.push('inject-sources');
  }
  return { normalized: out, rules };
}

function parseStructuredPayload(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;

  const cleaned = stripMarkdownFence(raw.trim());
  try {
    return JSON.parse(cleaned);
  } catch (directErr) {
    const extracted = extractFirstJsonObject(cleaned);
    if (!extracted) {
      parseFailedLog(cleaned, directErr);
      throw directErr;
    }
    try {
      return JSON.parse(extracted);
    } catch (extractErr) {
      parseFailedLog(extracted, extractErr);
      throw extractErr;
    }
  }
}

/**
 * Emit a one-line structured log when JSON.parse fails on LLM output, capturing
 * just the 80 chars on either side of the reported error position so a
 * maintainer can see exactly what shape (truncation, malformed bracket,
 * unexpected character) produced the failure. Never logs the full `raw`.
 *
 * Dev-only via the same lazy `app?.isPackaged` guard pattern as researchLog:
 * tests running under ELECTRON_RUN_AS_NODE get the stub `app` object where
 * `isPackaged` is `undefined` (falsy), so this helper remains observable in
 * dev and a no-op in production. No-op when `raw` is not a string.
 *
 * `position` is reported by V8's SyntaxError message (e.g. "in JSON at
 * position 4899 (line 71 column 255)"). We extract the position by regex;
 * if it cannot be found we emit `position=unknown` and skip the before/after
 * context fields so the log line shape stays stable.
 */
function parseFailedLog(raw: string, err: unknown): void {
  if (app?.isPackaged) return;
  const msg = (err as { message?: unknown })?.message;
  if (typeof msg !== 'string') {
    console.log('[Research] stage=parse-failed position=unknown');
    return;
  }
  const posMatch = msg.match(/position\s+(\d+)/i);
  const lineColMatch = msg.match(/\(line\s+(\d+)\s+column\s+(\d+)\)/i);
  if (!posMatch) {
    console.log('[Research] stage=parse-failed position=unknown');
    return;
  }
  const position = Number(posMatch[1]);
  const start = Math.max(0, position - 80);
  const end = Math.min(raw.length, position + 80);
  // Substring spans across the error position; embedded newlines inside the
  // window are intentional — they let the maintainer see the actual LLM
  // output shape (including any literal "\n" the model may have emitted)
  // rather than a "cleaned" view that hides the problem.
  const contextBefore = raw.slice(start, position);
  const contextAfter = raw.slice(position, end);
  const fields: string[] = [`position=${position}`];
  if (lineColMatch) {
    fields.push(`line=${lineColMatch[1]}`, `column=${lineColMatch[2]}`);
  }
  fields.push(`contextBefore=${JSON.stringify(contextBefore)}`);
  fields.push(`contextAfter=${JSON.stringify(contextAfter)}`);
  console.log(`[Research] stage=parse-failed ${fields.join(' ')}`);
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
