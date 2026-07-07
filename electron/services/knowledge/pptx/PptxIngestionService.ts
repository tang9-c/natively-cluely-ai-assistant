import type { KnowledgeMaterialChunkInput } from '../../../db/DatabaseManager';
import { buildSlideCleanedText } from './PptxMarkdownParser';
import type { PptxSlideRenderer } from './PptxSlideRenderer';
import type { PptxVisionDescriptor } from './PptxVisionDescriptor';

export type IndexPreparedChunks = (materialId: string, chunks: KnowledgeMaterialChunkInput[]) => Promise<void>;

export class PptxIngestionService {
  constructor(
    private readonly renderer: Pick<PptxSlideRenderer, 'renderToTempImages'>,
    private readonly descriptor: Pick<PptxVisionDescriptor, 'describeSlide' | 'enhanceMarkdown'>,
    private readonly indexPreparedChunks: IndexPreparedChunks,
  ) {}

  async ingest(materialId: string, filePath: string): Promise<void> {
    const deck = await this.renderer.renderToTempImages(filePath);
    try {
      const slideCount = deck.slides.length;
      if (slideCount > 200) throw new Error('pptx_too_many_slides');

      const chunks: KnowledgeMaterialChunkInput[] = [];
      for (const slide of deck.slides) {
        const markdown = await this.descriptor.describeSlide(slide.imagePath, slide.slideIndex, slideCount);
        const enhanced = await this.descriptor.enhanceMarkdown(markdown);
        const cleanedText = buildSlideCleanedText({
          slideIndex: slide.slideIndex,
          slideCount,
          markdown,
          summary: enhanced.summary,
          hypotheticalQuestions: enhanced.hypotheticalQuestions,
        });

        chunks.push({
          materialId,
          chunkIndex: slide.slideIndex - 1,
          parentChunkIndex: slide.slideIndex - 1,
          cleanedText,
          parentText: cleanedText,
          tokenCount: Math.max(1, Math.ceil(cleanedText.length / 4)),
          metadata: {
            source_format: 'pptx',
            slide_index: slide.slideIndex,
            slide_count: slideCount,
            vision_provider: 'natively',
            vision_model: 'lite32k',
          },
        });
      }

      await this.indexPreparedChunks(materialId, chunks);
    } finally {
      await deck.cleanup();
    }
  }
}
