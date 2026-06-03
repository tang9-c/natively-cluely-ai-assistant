// electron/services/screen/types.ts
// Shared types for the screen understanding layer.
// Extracted from PromptAssembler.ts to provide a single canonical definition.

// Screen context delivered to PromptAssembler and LLM pipelines.
//
// VISION-FIRST: extractedText, visibleSummary, screenType, codeBlocks, tables, errors
// come from a vision LLM call (ScreenUnderstandingService -> VisionProviderFallbackChain).
// LEGACY: ocrText is retained as an optional alias for older callers that still produce
// OCR text. New runtime paths must populate extractedText / visibleSummary instead.
export interface ScreenContext {
    /** @deprecated Legacy OCR text. New callers populate `extractedText` / `visibleSummary`. */
    ocrText?: string;
    imagePath?: string;
    activeWindowTitle?: string;
    timestamp: number;
    hash?: string;
    // Vision-first additions:
    extractedText?: string;
    visibleSummary?: string;
    screenType?: 'document' | 'code' | 'slide' | 'table' | 'chart' | 'ui' | 'error' | 'diagram' | 'dashboard' | 'unknown';
    codeBlocks?: string[];
    tables?: Array<{ title?: string; rows: string[][]; markdown?: string }>;
    errors?: string[];
    taskDetected?: string;
    confidence?: number;
    /** vision_direct | vision_extract | ocr_legacy */
    source?: string;
    providerUsed?: string;
    modelUsed?: string;
}
