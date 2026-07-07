# PPTX RAG Design

Date: 2026-07-07
Project: Natively / CueUp
Status: Approved design, implementation not started

## Goal

Add `.pptx` as a knowledge source format for Material RAG.

PPTX support is available only when the user has configured and selected QCLOUD API as the active AI provider, represented by provider id `natively`. If QCLOUD API is missing or not selected, PPTX upload is blocked before a material record is created.

The indexed result should behave like existing Markdown, TXT, PDF, and DOCX material RAG: searchable text chunks are embedded and stored in the existing knowledge material chunk tables.

## Hard Constraints

- Support `.pptx` only.
- Do not support `.ppt`.
- Do not support `.pptm`.
- Do not provide a pure text extraction fallback for PPTX.
- Do not split PPTX page content after extraction. One slide equals one chunk.
- Do not store rendered slide images after extraction.
- Do not expose image rendering, screenshots, thumbnails, or slide assets in the UI.
- Do not add image preview IPC.
- Do not send slide images during answer generation. RAG retrieval uses the extracted text only.
- Do not add new database tables or columns for this feature.

## User Experience

The user sees PPTX as another supported knowledge source type, with one clear condition:

> PPTX needs QCLOUD API to be configured and selected. Legacy `.ppt` is not supported.

User-facing text should talk about content extraction, not images or rendering.

Allowed user-facing states:

- `PPTX 知识源需要先配置并选择 QCLOUD API。`
- `暂不支持旧版 .ppt，请另存为 .pptx 后上传。`
- `暂不支持含宏 PPT，请另存为 .pptx 后上传。`
- `PPTX 文件已损坏或不是有效的 PowerPoint 文件。`
- `PPTX 页数超过 200，请拆分后上传。`
- `PPTX 内容提取失败，请另存为标准 .pptx 后重试。`
- `PPTX 内容提取失败，请稍后重试。`

Do not show these concepts in product UI:

- render
- image
- screenshot
- thumbnail
- slide assets
- base64
- vision

Those are implementation details.

## Architecture

Add a focused PPTX ingestion package:

```text
electron/services/knowledge/pptx/
├── createPptxFontMapping.ts
├── PptxSlideRenderer.ts
├── PptxVisionPrompt.ts
├── PptxEnhancePrompt.ts
├── PptxVisionDescriptor.ts
├── PptxMarkdownParser.ts
├── PptxIngestionService.ts
└── pptx-render-child.mjs
```

Responsibilities:

- `createPptxFontMapping.ts`: map known CJK and third-party font names to one platform font. This is for readable content extraction, not visual fidelity.
- `pptx-render-child.mjs`: run `pptx-glimpse` in a child process and write temporary `640x360` JPEG files.
- `PptxSlideRenderer.ts`: call the child process, enforce the 200-slide limit, apply timeouts, and return temporary image paths.
- `PptxVisionDescriptor.ts`: call `LLMHelper.generateWithNatively` only. Stage 1 sends one temporary image path to produce Markdown. Stage 2 sends Markdown only to produce summary and five hypothetical questions.
- `PptxIngestionService.ts`: orchestrate render, describe, enhance, chunk assembly, embedding, and temp cleanup.

Existing modules:

- `KnowledgeMaterialService`: add `.pptx` gate and route PPTX files to `PptxIngestionService`.
- `DocumentTextExtractor`: keep PPTX unsupported so it cannot bypass the multimodal path.
- `DatabaseManager`: no schema change for PPTX.
- `KnowledgeMaterialsSettings`: update supported-format text and add QCLOUD gate behavior without mentioning images.
- `ipcHandlers`, `preload`, `electron.d.ts`: add only the availability check needed by UI, not image preview APIs.

## Data Flow

```text
User selects .pptx
  -> UI checks QCLOUD availability
  -> main process checks QCLOUD availability again
  -> KnowledgeMaterialService creates queued material
  -> PptxIngestionService creates temp directory
  -> child process renders each slide to temporary JPEG
  -> lite32k turns each slide image into Markdown
  -> lite32k turns Markdown into summary + 5 questions
  -> one KnowledgeMaterialChunkInput per slide
  -> replaceKnowledgeMaterialChunks()
  -> EmbeddingPipeline embeds cleanedText
  -> temp directory is deleted in finally
```

The cleaned text for each slide should be self-contained:

```markdown
# Slide 3 / 20

<vision markdown>

## 本页摘要
...

## 本页可回答的问题
- ...
- ...
- ...
- ...
- ...
```

Chunk metadata remains lightweight and uses existing `metadata_json`:

```json
{
  "source_format": "pptx",
  "slide_index": 3,
  "slide_count": 20,
  "vision_provider": "natively",
  "vision_model": "lite32k"
}
```

No image path is stored.

## Reindex Behavior

PPTX reindex uses the same behavior as current material reindex: rebuild the index from already extracted chunk text.

The app does not store the source PPTX copy for re-rendering. If the user wants to rerun PPTX content extraction, they upload the PPTX again. This keeps PPTX ingestion aligned with existing PDF, DOCX, TXT, and Markdown material behavior and avoids turning the feature into document file management.

## Error Handling

Gate failures:

- `.pptx` without configured and selected QCLOUD API: reject before material creation.
- `.ppt`: reject before material creation.
- `.pptm`: reject before material creation.

Index failures:

- Invalid zip or corrupted file: mark material failed with a document-level message.
- More than 200 slides: mark material failed.
- Rendering failure: mark material failed. No text fallback.
- QCLOUD content extraction failure: mark material failed.
- Enhance JSON parse failure: retry once, then mark material failed.
- Embedding failure: follow existing material embedding fallback behavior. Text chunks remain available for keyword retrieval.

Cleanup:

- Temporary images are always deleted in `finally`.
- Logs may include counts, duration, provider id, model id, and error code.
- Logs must not include prompt text, extracted Markdown, user content, temporary image paths, image bytes, or base64.

## Testing

Unit and contract tests:

- `.pptx` is accepted only when QCLOUD API is configured and selected.
- `.pptx` is rejected without material creation when QCLOUD API is missing or not selected.
- `.ppt` and `.pptm` are rejected with user-facing conversion guidance.
- Dialog filters include `pptx` and exclude `ppt`.
- The old "PPTX coming soon" placeholder is removed.
- No `knowledge:get-slide-image` style IPC exists.
- PPTX ingestion creates one chunk per slide and does not call `buildParentChildChunks`.
- `cleanedText` contains Markdown, summary, and exactly five hypothetical questions.
- Temp files are deleted on success and failure.
- Stage 1 uses `generateWithNatively` with image paths.
- Stage 2 uses Markdown only and does not resend images.
- Font mapping covers the known CJK and third-party font aliases and maps them to the platform target font.

E2E and smoke:

- UI blocks PPTX upload when QCLOUD API is not configured or not selected.
- With fake QCLOUD extraction, uploading a sample PPTX completes and creates chunk count equal to slide count.
- Real QCLOUD smoke test is env-gated and excluded from default CI.

## Not In Scope

- `.ppt` support.
- `.pptm` support.
- Slide thumbnails.
- Image preview IPC.
- Long-term rendered image storage.
- Sending slide images during answer generation.
- Image embedding, ColPali, ColQwen, or late-interaction retrieval.
- Cloud PPT rendering APIs.
- Historical data migration.
- Pixel-perfect rendering fidelity.

## Success Criteria

- Users with QCLOUD API selected can upload `.pptx` files and query their content through existing Material RAG.
- Users without QCLOUD API selected get a clear blocking message and no failed material row is created.
- Each slide becomes one searchable chunk.
- Extracted summary and hypothetical questions improve retrieval recall without introducing a new schema.
- Temporary rendered images are deleted after extraction.
- Existing PDF, DOCX, TXT, and Markdown material behavior is unchanged.
