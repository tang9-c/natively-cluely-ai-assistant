# Realtime Answer Trust UX Design

Date: 2026-07-06

## Goal

Improve the user-facing trust experience for CueUp realtime answers and local material RAG without expanding the core LLM, RAG, or dynamic-action algorithms.

This design covers exactly five UX improvements:

1. A lightweight productized diagnostics entry for recent realtime answer quality.
2. Clearer material-backed answer experience in the realtime answer surface.
3. Clear next steps for failed uploaded materials.
4. More precise embedding degradation messages.
5. User-understandable explanations for realtime answers and dynamic actions.

## Non-Goals

- Do not build a full analytics dashboard.
- Do not add new model inference, new providers, or new RAG algorithms.
- Do not implement real PPTX parsing in this scope.
- Do not persist raw transcript, prompt, screenshot path, screenshot body, material chunk text, dynamic-action evidence text, or provider credentials in new diagnostics.
- Do not change dynamic action triggering policy in this scope.
- Do not make failed materials appear retryable unless the product action is truly supported.

## Current Context

Phase 0 already has answer trace metadata, source status, degraded reasons, citation preview, quality events, `AnswerMetricsOfflineHarness`, and `ContextQualityDiagnostics`.

Phase 1 already has first-version material RAG acceptance:

- PDF, DOCX, Markdown, and TXT extraction.
- File-level `queued`, `indexing`, `complete`, and `failed` states.
- Failed material records with readable errors.
- Completed material reindexing from existing chunk text.
- Deletion that prevents future retrieval or valid citation.
- Lexical fallback when embedding is unavailable or write fails.
- PPTX non-support coverage: visible "coming soon" messaging and service-side `unsupported_file_type`.

The remaining product gap is not raw capability. The gap is that users cannot always tell why an answer was trusted, why uploaded material was not used, what to do after material failure, or why CueUp degraded to keyword matching.

## Recommended Approach

Use a layered, lightweight productization approach.

Do not build a large dashboard. Instead, add a thin UI-facing diagnostic view model that translates existing trace and status data into stable product explanations. Then surface those explanations in the places users already look:

- Realtime answer and citation area.
- Knowledge materials settings.
- Dynamic action cards.
- A small settings diagnostics section for recent answer quality.

This keeps the implementation focused, avoids new sensitive data paths, and leaves room for a richer dashboard later.

## Architecture

### UI-Facing Diagnostic View Model

Add a narrow read-only explanation layer that consumes existing internal data and produces JSON-safe UI summaries.

Suggested module shape:

- `RealtimeAnswerTrustSummary`
- `AnswerSourceExplanation`
- `MaterialStatusExplanation`
- `EmbeddingDegradationExplanation`
- `DynamicActionExplanation`
- `AnswerQualityMetricSummary`

The exact file location can follow current project conventions, for example under `electron/services/eval/` or a nearby `electron/services/trust/` folder if that reads cleaner during implementation.

This layer must:

- Accept existing `AnswerContextTrace`, `sourceStatus`, `degradedReasons`, material status rows, answer quality metrics, and dynamic action semantic gate metadata.
- Return product-safe status labels, counts, reason labels, and short explanations.
- Centralize reason-code-to-copy mapping so renderer components do not each invent their own wording.
- Never include raw transcript, prompt, screenshot path, screenshot content, material chunk text, or dynamic-action evidence text.

### IPC Boundary

Add a read-only IPC endpoint for diagnostics summary, for example:

- `quality:get-realtime-diagnostics-summary`

The endpoint should return recent aggregate information only:

- Answer latency summary, including p95 when enough samples exist.
- Citation hit rate.
- RAG hit rate.
- No-context answer rate.
- Accept and regenerate rates.
- Degraded reason distribution.
- Recent source status counts.

The endpoint should tolerate missing data and return an empty summary with a clear status instead of throwing into the UI.

### Renderer Integration

Renderer components should consume the UI-facing summaries and explanation strings. They should not directly inspect internal reason codes except in tests that verify the mapping layer is wired.

## UX Surfaces

### 1. Realtime Answer Source And Trust Explanation

Add a lightweight expandable area near the latest answer or citation preview.

It should answer:

- Which sources were used?
- Which sources were unavailable, blocked, missed, or degraded?
- Was uploaded material used?
- Did the answer have a citation?
- If no citation appeared, was that because RAG missed, RAG was unavailable, provider scope blocked it, or no relevant material existed?

Example user-facing messages:

- "已使用上传资料：Product FAQ。"
- "没有匹配到相关上传资料。"
- "屏幕上下文因权限被阻止。"
- "未配置语义检索，CueUp 已使用关键词匹配。"
- "这条回答没有引用，因为没有找到相关上传资料。"

### 2. Material-Backed Answer Experience

The realtime answer experience should make material usage visible without over-claiming.

When uploaded material is used:

- Show a concise source label or citation title.
- Distinguish a real citation from a preview or unavailable citation.

When uploaded material is not used:

- Show a short reason if available.
- Do not imply uploaded material was used when `uploadedMaterialHitCount` is zero or RAG failed.

This directly supports the user scenario: upload a product FAQ, ask a meeting question, and know whether CueUp actually used that FAQ.

### 3. Failed Material Next Step

Knowledge materials settings should make failed materials actionable and honest.

For completed materials:

- Keep the existing reindex action.
- Explain that reindexing rebuilds the index from stored extracted text.

For failed materials:

- Do not present reindex as a working recovery path.
- Show the failure reason and next step.

Reason examples:

- `unsupported_file_type`: "暂不支持此格式。请导出为 PDF 或 Markdown 后重新上传。"
- `binary_text_file`: "这个 TXT 文件像是二进制内容。请上传可读的 TXT、PDF、DOCX 或 Markdown 文件。"
- `parse_failed`: "CueUp 无法读取这个文件。请重新导出或上传更干净的副本。"
- `empty_document`: "没有找到可读取文本。请上传包含可选中文本的文档。"
- `embedding_failed`: "资料文本已索引，但语义检索失败。CueUp 会尝试降级为关键词匹配。"

The primary action for failed material should be "Upload again" or clear guidance to upload a replacement, not "Reindex", unless implementation later stores enough source data to perform a true retry.

### 4. Embedding Degradation Copy

Separate three user-facing states:

1. Embedding provider not configured.
   - "未配置语义检索。CueUp 会对上传资料使用关键词匹配。"
2. Embedding write failed during indexing.
   - "资料文本可用，但语义索引失败。CueUp 仍可尝试关键词匹配。"
3. Query-time hybrid fallback.
   - "这次语义检索失败，CueUp 已使用关键词匹配。"

These states should be visible where they matter:

- In materials settings for index-time or configuration problems.
- In answer/source explanation for query-time fallback.
- In diagnostics summary for aggregate degraded reasons.

### 5. Dynamic Action And Realtime Answer Explainability

Dynamic action cards should include a compact explanation that avoids internal implementation noise.

Examples:

- "基于当前发言和最近上下文触发。"
- "已通过语义门控。"
- "相似的低置信候选已被拦截。"

If semantic gate trace is missing:

- Do not invent a semantic explanation.
- Show a conservative label such as "Triggered by meeting signal."
- Record the missing trace in diagnostics.

Detailed cloud/local arbitration data should remain in diagnostics, not ordinary card text.

## Data And Privacy Rules

The UI-facing diagnostics may expose:

- Source type.
- Status.
- Counts.
- Latency metrics.
- Citation count and safe citation title.
- Degraded reason labels.
- Material title and status.
- Dynamic action type and gate decision summary.

The UI-facing diagnostics must not expose:

- Raw transcript.
- Prompt.
- Screenshot path.
- Screenshot body.
- Evidence text.
- Material chunk text.
- Provider credentials.
- Dynamic action evidence text.

All new logs must continue to use existing redaction utilities when logging is necessary. Prefer no new logs unless needed for non-sensitive error reporting.

## Error Handling

- Diagnostics unavailable: show "暂无诊断数据" and keep answer generation unaffected.
- Trace persistence failed: answer still displays; diagnostics says "本次回答诊断未保存".
- Missing material row for a citation: show a stale or unavailable citation state, not a clickable valid source.
- Failed material: show reason-specific copy and upload-again guidance.
- Dynamic action missing gate trace: show conservative explanation and mark diagnostics as incomplete.

## Testing Strategy

### Main / Service Tests

Add or extend tests that verify:

- UI-facing diagnostics never include transcript, prompt, screenshot path/body, material chunk text, or evidence text.
- Degraded reason codes map to stable Chinese product copy.
- Embedding not configured, embedding write failed, and query-time fallback are distinguishable.
- Failed material reasons map to correct next-step guidance.
- Diagnostics summary tolerates empty data and trace persistence failure.

### Renderer / Contract Tests

Add or extend tests that verify:

- Realtime answer area can display used sources and degraded source explanations.
- Material settings do not show a misleading reindex action for failed materials.
- Material settings show upload-again guidance for failed material.
- Dynamic action card shows a concise semantic explanation when metadata exists.
- Diagnostics entry renders latency, citation hit rate, RAG hit rate, accept/regenerate rate, no-context answer rate, and degraded reason distribution.

### Quality Commands

Because this feature changes Phase 0 and Phase 1 trust UX, the new tests should be included in one of:

- `test:quality:smoke:no-build`
- `test:quality:diagnostics:no-build`

Implementation should keep the existing full commands valid:

- `npm run test:quality:gate`
- `npm run test:quality:gate:no-build`

## Acceptance Criteria

- A user can tell whether the latest realtime answer used uploaded material.
- A user can tell why uploaded material was not used when it was not used.
- A failed uploaded material shows a clear reason and an honest next step.
- Embedding degradation is not collapsed into a vague "RAG failed" message.
- A dynamic action card can explain why it appeared without exposing raw evidence.
- The diagnostics entry shows recent answer quality metrics without exposing sensitive content.
- Tests prove that the new explanation layer is privacy-safe and that the five UX improvements render from controlled fixtures.

## Implementation Boundaries

This design should be implemented incrementally:

1. Build the UI-facing explanation mapper and tests.
2. Add the read-only diagnostics summary IPC and tests.
3. Wire material settings failed/reindex/embedding copy.
4. Wire realtime answer source explanation.
5. Wire dynamic action explanation.
6. Add quality command coverage.

Each step should preserve the existing answer generation behavior.
