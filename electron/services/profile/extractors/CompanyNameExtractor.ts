import type { ParserLLM } from '../parsers/ParserLLM';

const SCHEMA_DESCRIPTION = `
Extract the company name from the provided text into this JSON schema:
{
  "companyName": string | null
}
Use null if no clear company name is present.
`;

const SUPPORTED_DOC_SUBTYPES = new Set(['company-research', 'job-description']);

function buildPrompt(rawText: string): string {
  return [
    'You are a company-name extractor. Read the text below and identify the single most relevant company name.',
    'Return only the company name as a JSON object. If no company name is present, return { "companyName": null }.',
    '',
    '--- TEXT ---',
    rawText.slice(0, 4_000),
  ].join('\n');
}

export class CompanyNameExtractor {
  constructor(private parserLLM: ParserLLM) {}

  async extract(rawText: string, docSubtype: string): Promise<string | null> {
    if (!SUPPORTED_DOC_SUBTYPES.has(docSubtype)) {
      return null;
    }

    const trimmed = rawText?.trim();
    if (!trimmed) {
      return null;
    }

    try {
      const parsed = await this.parserLLM.parse<{ companyName?: string | null }>(
        buildPrompt(trimmed),
        SCHEMA_DESCRIPTION,
      );
      const companyName = parsed?.companyName;
      if (typeof companyName === 'string') {
        const normalized = companyName.trim();
        return normalized.length > 0 ? normalized : null;
      }
      return null;
    } catch (error: any) {
      console.warn('[CompanyNameExtractor] Extraction failed:', error.message);
      return null;
    }
  }
}
