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

  const rules = sanitizeSenseVoiceTerms(terms)
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
