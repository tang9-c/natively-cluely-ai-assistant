import type { JDParsed } from '../types';
import { ParserLLM } from './ParserLLM';

const SCHEMA_DESCRIPTION = `
Extract a job description into this JSON schema:
{
  "title": string (required),
  "company": string | undefined,
  "level": string | undefined (e.g. "Senior", "Staff", "Junior"),
  "location": string | undefined,
  "technologies": string[] (required),
  "requirements": string[] (required),
  "keywords": string[] (required),
  "responsibilities": string[] (required),
  "compensation_hint": string | undefined,
  "min_years_experience": number | undefined
}
`;

function buildPrompt(rawText: string): string {
  return [
    'You are a job-description parser. Read the text below and extract structured information.',
    'Be concise. technologies, requirements, keywords, and responsibilities should be short phrases or single words.',
    '',
    '--- JOB DESCRIPTION TEXT ---',
    rawText.slice(0, 24_000),
  ].join('\n');
}

function normalize(parsed: any): JDParsed {
  const pickStrings = (arr: any) =>
    Array.isArray(arr)
      ? arr.filter((s: any) => typeof s === 'string' && s.length > 0)
      : [];

  return {
    title: String(parsed?.title ?? 'Untitled Position'),
    company: parsed?.company ? String(parsed.company) : undefined,
    level: parsed?.level ? String(parsed.level) : undefined,
    location: parsed?.location ? String(parsed.location) : undefined,
    technologies: pickStrings(parsed?.technologies),
    requirements: pickStrings(parsed?.requirements),
    keywords: pickStrings(parsed?.keywords),
    responsibilities: pickStrings(parsed?.responsibilities),
    compensation_hint: parsed?.compensation_hint ? String(parsed.compensation_hint) : undefined,
    min_years_experience:
      typeof parsed?.min_years_experience === 'number'
        ? parsed.min_years_experience
        : undefined,
  };
}

export class JDParser {
  constructor(private llm: ParserLLM) {}

  async parse(rawText: string): Promise<JDParsed> {
    const prompt = buildPrompt(rawText);
    const parsed = await this.llm.parse<any>(prompt, SCHEMA_DESCRIPTION);
    return normalize(parsed);
  }
}
