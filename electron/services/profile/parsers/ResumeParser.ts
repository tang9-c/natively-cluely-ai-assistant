import type { ResumeParsed } from '../types';
import { ParserLLM } from './ParserLLM';

const SCHEMA_DESCRIPTION = `
Extract a resume into this JSON schema:
{
  "identity": {
    "name": string (required),
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
`;

function buildPrompt(rawText: string): string {
  return [
    'You are a resume parser. Read the resume text below and extract structured information.',
    'Be concise. Dates should use YYYY-MM format when available.',
    '',
    '--- RESUME TEXT ---',
    rawText.slice(0, 24_000),
  ].join('\n');
}

function normalize(parsed: any): ResumeParsed {
  const identity = {
    name: String(parsed?.identity?.name ?? 'Unknown'),
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

export class ResumeParser {
  constructor(private llm: ParserLLM) {}

  async parse(rawText: string): Promise<ResumeParsed> {
    const prompt = buildPrompt(rawText);
    const parsed = await this.llm.parse<any>(prompt, SCHEMA_DESCRIPTION);
    const result = normalize(parsed);
    // Defensive: if the model returns a skeleton with no real data, treat as failure
    // so ParserLLM's retry loop gets a second attempt with stronger instructions.
    const hasAnyData =
      result.identity.name && result.identity.name !== 'Unknown' && result.identity.name.trim().length > 0 ||
      result.skills.length > 0 ||
      result.experience.length > 0 ||
      result.projects.length > 0 ||
      result.education.length > 0;
    if (!hasAnyData) {
      throw new Error('Parsed resume is empty — model returned skeleton with no extracted data');
    }
    return result;
  }
}
