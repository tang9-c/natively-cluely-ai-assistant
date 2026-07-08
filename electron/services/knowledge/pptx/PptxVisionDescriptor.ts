import { buildPptxEnhancePrompt } from './PptxEnhancePrompt';
import { normalizePptxMarkdown, parsePptxEnhanceJson, type PptxEnhanceResult } from './PptxMarkdownParser';
import { buildPptxVisionPrompt } from './PptxVisionPrompt';
import { QCLOUD_DEFAULT_OUTPUT_TOKENS, QCLOUD_PPTX_ENHANCE_OUTPUT_TOKENS } from '../../../llm/QCloudLlmConstants';

export interface PptxKnowledgeLlm {
  generatePptxKnowledgeWithNatively(userMessage: string, systemPrompt?: string, imagePaths?: string[], options?: { maxOutputTokens?: number }): Promise<string>;
}

export class PptxVisionDescriptor {
  constructor(private readonly llmHelper: PptxKnowledgeLlm) {}

  async describeSlide(imagePath: string, slideIndex: number, slideCount: number): Promise<string> {
    const prompt = buildPptxVisionPrompt(slideIndex, slideCount);
    const text = await this.llmHelper.generatePptxKnowledgeWithNatively(prompt, undefined, [imagePath], { maxOutputTokens: QCLOUD_DEFAULT_OUTPUT_TOKENS });
    const markdown = normalizePptxMarkdown(text);
    if (!markdown) throw new Error('pptx_markdown_empty');
    return markdown;
  }

  async enhanceMarkdown(markdown: string): Promise<PptxEnhanceResult> {
    const prompt = buildPptxEnhancePrompt(markdown);
    try {
      return parsePptxEnhanceJson(await this.llmHelper.generatePptxKnowledgeWithNatively(prompt, undefined, undefined, { maxOutputTokens: QCLOUD_PPTX_ENHANCE_OUTPUT_TOKENS }));
    } catch (error) {
      if ((error as Error)?.message !== 'pptx_enhance_invalid_json') {
        throw error;
      }
      return parsePptxEnhanceJson(await this.llmHelper.generatePptxKnowledgeWithNatively(prompt, undefined, undefined, { maxOutputTokens: QCLOUD_PPTX_ENHANCE_OUTPUT_TOKENS }));
    }
  }
}
