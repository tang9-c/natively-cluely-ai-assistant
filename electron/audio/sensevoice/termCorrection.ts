import type { SenseVoiceTermEntry } from './types';

const MAX_TERMS = 200;
const MAX_VARIANTS = 20;
const MAX_TERM_CHARS = 80;

interface CorrectionRule {
  canonical: string;
  variant: string;
  index: number;
}

interface CorrectionMatch {
  start: number;
  end: number;
  canonical: string;
  ruleIndex: number;
}

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function isAscii(value: string): boolean {
  return /^[\x00-\x7F]+$/.test(value);
}

function isSafeVariant(value: string): boolean {
  const text = normalizeText(value);
  if (!text) return false;
  return isAscii(text) ? text.length >= 3 : text.length >= 2;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildVariantRegex(variant: string): RegExp {
  const escaped = escapeRegExp(variant);
  if (isAscii(variant)) {
    return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, 'g');
  }
  return new RegExp(escaped, 'g');
}

export function sanitizeSenseVoiceTerms(input: unknown): SenseVoiceTermEntry[] {
  if (!Array.isArray(input)) return [];

  const terms: SenseVoiceTermEntry[] = [];
  const seenCanonical = new Set<string>();

  for (const row of input) {
    if (!row || typeof row !== 'object') continue;
    const raw = row as Record<string, unknown>;
    const canonical = normalizeText(raw.canonical).slice(0, MAX_TERM_CHARS);
    if (!canonical) continue;

    const canonicalKey = canonical.toLowerCase();
    if (seenCanonical.has(canonicalKey)) continue;
    seenCanonical.add(canonicalKey);

    const variants: string[] = [];
    const seenVariants = new Set<string>();
    const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];

    for (const rawVariant of rawVariants) {
      const variant = normalizeText(rawVariant).slice(0, MAX_TERM_CHARS);
      const variantKey = variant.toLowerCase();
      if (!isSafeVariant(variant)) continue;
      if (variant === canonical) continue;
      if (seenVariants.has(variantKey)) continue;
      seenVariants.add(variantKey);
      variants.push(variant);
      if (variants.length >= MAX_VARIANTS) break;
    }

    const id = normalizeText(raw.id).slice(0, MAX_TERM_CHARS) || canonical;
    terms.push({
      id,
      canonical,
      variants,
      enabled: raw.enabled !== false,
    });

    if (terms.length >= MAX_TERMS) break;
  }

  return terms;
}

// Persistence rejects invalid input instead of silently sanitizing user edits.
export function validateSenseVoiceTerms(input: unknown, maxTerms = MAX_TERMS): SenseVoiceTermEntry[] {
  if (!Array.isArray(input) || input.length > maxTerms) throw new Error('词条最多 200 条，请在原词表管理页整理后重试。');
  const canonicals = new Set<string>();
  const variants = new Map<string, string>();
  return input.map(row => {
    if (!row || typeof row !== 'object' || typeof row.canonical !== 'string' || !Array.isArray(row.variants)) throw new Error('词条格式无效。');
    const canonical = normalizeText(row.canonical);
    if (!canonical || canonical.length > MAX_TERM_CHARS) throw new Error('正确词须为 1–80 字符。');
    const key = canonical.toLowerCase();
    if (canonicals.has(key)) throw new Error('正确词重复，请在原词表管理页合并。');
    canonicals.add(key);
    if (row.variants.length > MAX_VARIANTS) throw new Error('每个正确词最多 20 个错词。');
    const normalizedVariants: string[] = row.variants.map((value: unknown) => {
      const variant = normalizeText(value);
      if (typeof value !== 'string' || variant.length > MAX_TERM_CHARS || !isSafeVariant(variant) || variant === canonical) {
        throw new Error('错词须为 2–80 字符，纯 ASCII 错词至少 3 字符，且须与正确词不同。');
      }
      const variantKey = variant.toLowerCase();
      const target = variants.get(variantKey);
      if (target && target !== key) throw new Error('同一错词已有不同正确词，请到原词表管理页处理冲突。');
      variants.set(variantKey, key);
      return variant;
    });
    return { id: normalizeText(row.id) || canonical, canonical, variants: [...new Set(normalizedVariants)], enabled: row.enabled !== false };
  });
}

function collectMatches(text: string, rules: CorrectionRule[]): CorrectionMatch[] {
  const matches: CorrectionMatch[] = [];

  rules.forEach((rule) => {
    const regex = buildVariantRegex(rule.variant);
    for (const match of text.matchAll(regex)) {
      if (typeof match.index !== 'number') continue;
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        canonical: rule.canonical,
        ruleIndex: rule.index,
      });
    }
  });

  matches.sort((a, b) => {
    if (a.start !== b.start) return a.start - b.start;
    const aLength = a.end - a.start;
    const bLength = b.end - b.start;
    if (aLength !== bLength) return bLength - aLength;
    // Equal-length matches at the same offset are ambiguous; keep settings order deterministic.
    return a.ruleIndex - b.ruleIndex;
  });

  const selected: CorrectionMatch[] = [];
  let cursor = 0;
  for (const match of matches) {
    if (match.start < cursor) continue;
    selected.push(match);
    cursor = match.end;
  }
  return selected;
}

export function applySenseVoiceTermCorrection(text: string, terms: SenseVoiceTermEntry[]): string {
  if (!text || !Array.isArray(terms) || terms.length === 0) return text;

  const rules = terms.flatMap(term => sanitizeSenseVoiceTerms([term]))
    .filter(term => term.enabled)
    .flatMap(term => term.variants.map(variant => ({ canonical: term.canonical, variant })))
    .filter(rule => rule.variant && rule.variant !== rule.canonical)
    .sort((a, b) => b.variant.length - a.variant.length)
    .map((rule, index) => ({ ...rule, index }));

  if (rules.length === 0) return text;

  const matches = collectMatches(text, rules);
  if (matches.length === 0) return text;

  let output = '';
  let cursor = 0;
  for (const match of matches) {
    output += text.slice(cursor, match.start);
    output += match.canonical;
    cursor = match.end;
  }
  output += text.slice(cursor);
  return output;
}
