"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ResumeParser = void 0;
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
function buildPrompt(rawText) {
    return [
        'You are a resume parser. Read the resume text below and extract structured information.',
        'Be concise. Dates should use YYYY-MM format when available.',
        '',
        '--- RESUME TEXT ---',
        rawText.slice(0, 24_000),
    ].join('\n');
}
function normalize(parsed) {
    const identity = {
        name: String(parsed?.identity?.name ?? 'Unknown'),
        email: parsed?.identity?.email ? String(parsed.identity.email) : undefined,
        phone: parsed?.identity?.phone ? String(parsed.identity.phone) : undefined,
        location: parsed?.identity?.location ? String(parsed.identity.location) : undefined,
        linkedin: parsed?.identity?.linkedin ? String(parsed.identity.linkedin) : undefined,
    };
    const skills = Array.isArray(parsed?.skills)
        ? parsed.skills.filter((s) => typeof s === 'string' && s.length > 0)
        : [];
    const experience = Array.isArray(parsed?.experience)
        ? parsed.experience
            .filter((e) => e && (e.title || e.organization))
            .map((e) => ({
            title: String(e.title ?? ''),
            organization: String(e.organization ?? ''),
            start: e.start ? String(e.start) : undefined,
            end: e.end ? String(e.end) : undefined,
            description: e.description ? String(e.description) : undefined,
        }))
        : [];
    const projects = Array.isArray(parsed?.projects)
        ? parsed.projects
            .filter((p) => p && p.name)
            .map((p) => ({
            name: String(p.name),
            description: p.description ? String(p.description) : undefined,
        }))
        : [];
    const education = Array.isArray(parsed?.education)
        ? parsed.education
            .filter((e) => e && (e.degree || e.institution || e.year))
            .map((e) => ({
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
class ResumeParser {
    llm;
    constructor(llm) {
        this.llm = llm;
    }
    async parse(rawText) {
        const prompt = buildPrompt(rawText);
        const parsed = await this.llm.parse(prompt, SCHEMA_DESCRIPTION);
        return normalize(parsed);
    }
}
exports.ResumeParser = ResumeParser;
//# sourceMappingURL=ResumeParser.js.map