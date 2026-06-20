import type { ResumeParsed } from '../types';
import { ParserLLM } from './ParserLLM';

const SCHEMA_DESCRIPTION = `
Extract a resume into this JSON schema:
{
  "identity": {
    "name": string (required - the person's full name, NEVER "Unknown" or empty),
    "email": string | undefined,
    "phone": string | undefined,
    "location": string | undefined,
    "linkedin": string | undefined
  },
  "summary": string | undefined,
  "skills": string[] (required),
  "experience": [
    {
      "title": string (required),
      "organization": string (required),
      "start": string | undefined (e.g. "2020-01"),
      "end": string | undefined (e.g. "2023-01" or "Present"),
      "description": string | undefined
    }
  ] (required),
  "projects": [
    {
      "name": string (required),
      "description": string | undefined
    }
  ] (required),
  "education": [
    {
      "degree": string | undefined,
      "institution": string | undefined,
      "year": string | undefined
    }
  ] (required)
}

CRITICAL: The identity.name field must contain the actual full name found in the resume. Do NOT use placeholders like "Unknown" or empty strings. If the name is not clearly present, extract the best candidate from the header/contact section.
`;

function buildPrompt(rawText: string, attempt: number): string {
  const base = [
    'You are a resume parser. Read the resume text below and extract structured information.',
    'Be concise. Dates should use YYYY-MM format when available.',
    '',
    '--- RESUME TEXT ---',
    rawText.slice(0, 24_000),
  ].join('\n');

  if (attempt === 0) return base;

  return `${base}\n\nCRITICAL: Your previous response was missing the candidate's real full name or contained placeholder values like "Unknown". You MUST extract the actual person's full name from the resume header or contact section. Do NOT return "Unknown" or empty strings. Fill every field with real information found in the text.`;
}

function normalize(parsed: any): ResumeParsed {
  const rawName = parsed?.identity?.name;
  // Treat LLM fallback placeholders as missing so the retry loop gets a chance
  // to extract the real name from the resume text.
  const normalizedName =
    rawName && typeof rawName === 'string' && rawName.trim() && rawName.trim().toLowerCase() !== 'unknown'
      ? rawName.trim()
      : '';

  const identity = {
    name: normalizedName || 'Unknown',
    email: parsed?.identity?.email ? String(parsed.identity.email) : undefined,
    phone: parsed?.identity?.phone ? String(parsed.identity.phone) : undefined,
    location: parsed?.identity?.location ? String(parsed.identity.location) : undefined,
    linkedin: parsed?.identity?.linkedin ? String(parsed.identity.linkedin) : undefined,
  };

  const skills = Array.isArray(parsed?.skills)
    ? parsed.skills.filter((s: any) => typeof s === 'string' && s.length > 0)
    : [];

  const experience = Array.isArray(parsed?.experience)
    ? parsed.experience
        .filter((e: any) => e && (e.title || e.organization))
        .map((e: any) => ({
          title: String(e.title ?? ''),
          organization: String(e.organization ?? ''),
          start: e.start ? String(e.start) : undefined,
          end: e.end ? String(e.end) : undefined,
          description: e.description ? String(e.description) : undefined,
        }))
    : [];

  const projects = Array.isArray(parsed?.projects)
    ? parsed.projects
        .filter((p: any) => p && p.name)
        .map((p: any) => ({
          name: String(p.name),
          description: p.description ? String(p.description) : undefined,
        }))
    : [];

  const education = Array.isArray(parsed?.education)
    ? parsed.education
        .filter((e: any) => e && (e.degree || e.institution || e.year))
        .map((e: any) => ({
          degree: e.degree ? String(e.degree) : undefined,
          institution: e.institution ? String(e.institution) : undefined,
          year: e.year ? String(e.year) : undefined,
        }))
    : [];

  return {
    identity,
    summary: parsed?.summary ? String(parsed.summary) : undefined,
    skills,
    experience,
    projects,
    education,
  };
}

function isValidResult(result: ResumeParsed): boolean {
  const hasValidName =
    result.identity.name &&
    result.identity.name !== 'Unknown' &&
    result.identity.name.trim().length > 0;
  return hasValidName;
}

export class ResumeParser {
  constructor(private llm: ParserLLM) {}

  async parse(rawText: string): Promise<ResumeParsed> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const prompt = buildPrompt(rawText, attempt);
        const parsed = await this.llm.parse<any>(prompt, SCHEMA_DESCRIPTION);
        const result = normalize(parsed);
        if (isValidResult(result)) {
          return result;
        }
        throw new Error('Parsed resume is empty — model returned skeleton with no extracted data');
      } catch (error: any) {
        console.warn('[ResumeParser] Attempt', attempt + 1, 'failed:', error.message);
        lastError = error;
      }
    }
    throw lastError ?? new Error('Could not parse resume after multiple attempts');
  }
}
