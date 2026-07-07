export interface PptxEnhanceResult {
  summary: string;
  hypotheticalQuestions: string[];
}

export function normalizePptxMarkdown(raw: string): string {
  return String(raw || '').trim();
}

export function parsePptxEnhanceJson(raw: string): PptxEnhanceResult {
  let parsed: any;
  try {
    parsed = JSON.parse(String(raw || '').trim());
  } catch {
    throw new Error('pptx_enhance_invalid_json');
  }
  const summary = String(parsed?.summary || '').trim();
  const questions = Array.isArray(parsed?.hypothetical_questions)
    ? parsed.hypothetical_questions.map((item: unknown) => String(item || '').trim()).filter(Boolean)
    : [];
  if (!summary) throw new Error('pptx_enhance_missing_summary');
  if (questions.length !== 5) throw new Error('pptx_enhance_invalid_questions');
  return { summary, hypotheticalQuestions: questions };
}

export function buildSlideCleanedText(input: {
  slideIndex: number;
  slideCount: number;
  markdown: string;
  summary: string;
  hypotheticalQuestions: string[];
}): string {
  return [
    `# Slide ${input.slideIndex} / ${input.slideCount}`,
    normalizePptxMarkdown(input.markdown),
    '## 本页摘要',
    input.summary.trim(),
    '## 本页可回答的问题',
    ...input.hypotheticalQuestions.map((question) => `- ${question}`),
  ].filter(Boolean).join('\n\n');
}
