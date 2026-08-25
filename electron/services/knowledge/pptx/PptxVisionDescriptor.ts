import { buildPptxEnhancePrompt } from './PptxEnhancePrompt';
import { normalizePptxMarkdown, parsePptxEnhanceJson, type PptxEnhanceResult } from './PptxMarkdownParser';
import { buildPptxVisionPrompt } from './PptxVisionPrompt';
import { QCLOUD_DEFAULT_OUTPUT_TOKENS, QCLOUD_PPTX_ENHANCE_OUTPUT_TOKENS } from '../../../llm/QCloudLlmConstants';

const PPTX_LLM_TIMEOUT_MS = 20_000;

export interface PptxKnowledgeLlm {
  generatePptxKnowledgeWithNatively(userMessage: string, systemPrompt?: string, imagePaths?: string[], options?: { maxOutputTokens?: number; timeoutMs?: number }): Promise<string>;
}

export class PptxVisionDescriptor {
  constructor(private readonly llmHelper: PptxKnowledgeLlm) {}

  async describeSlide(imagePath: string, slideIndex: number, slideCount: number): Promise<string> {
    const prompt = buildPptxVisionPrompt(slideIndex, slideCount);
    const text = await this.llmHelper.generatePptxKnowledgeWithNatively(prompt, undefined, [imagePath], {
      maxOutputTokens: QCLOUD_DEFAULT_OUTPUT_TOKENS,
      timeoutMs: PPTX_LLM_TIMEOUT_MS,
    });
    const markdown = normalizePptxMarkdown(text);
    if (!markdown) throw new Error('pptx_markdown_empty');
    return markdown;
  }

  async enhanceMarkdown(markdown: string): Promise<PptxEnhanceResult> {
    const prompt = buildPptxEnhancePrompt(markdown);
    try {
      return parsePptxEnhanceJson(await this.llmHelper.generatePptxKnowledgeWithNatively(prompt, undefined, undefined, {
        maxOutputTokens: QCLOUD_PPTX_ENHANCE_OUTPUT_TOKENS,
        timeoutMs: PPTX_LLM_TIMEOUT_MS,
      }));
    } catch (error) {
      if ((error as Error)?.message !== 'pptx_enhance_invalid_json') {
        throw error;
      }
      return parsePptxEnhanceJson(await this.llmHelper.generatePptxKnowledgeWithNatively(prompt, undefined, undefined, {
        maxOutputTokens: QCLOUD_PPTX_ENHANCE_OUTPUT_TOKENS,
        timeoutMs: PPTX_LLM_TIMEOUT_MS,
      }));
    }
  }
}
