# Sales Real STT Recognition Optimization Design

## Summary

This design improves real sales meeting transcription quality using the completed
QCLOUD / Direct Doubao / Local SenseVoice benchmark results. The implementation
must not rerun the completed parameter matrix as a prerequisite.

The verified sample set is:

- `sales-real-001`
- `sales-real-003`
- `sales-real-004`
- `sales-real-005`
- `sales-real-006`

Completed private baseline reports:

- `tests/fixtures/dynamic-actions/replay/private/stt-benchmark/matrix/stt-provider-matrix-1784097760039.json`
- `tests/fixtures/dynamic-actions/replay/private/stt-benchmark/matrix/stt-provider-matrix-1784097884878.json`

The completed results show:

- QCLOUD AUC and Direct Doubao AUC are effectively equivalent on the current
  five-sample set.
- QCLOUD parameter toggles are not a meaningful quality lever yet.
- Request-time Doubao dynamic industrial corpus context is not viable in the
  current implementation.
- The strongest positive signal is audio windowing: `sales-real-001` changed
  from failed at `300:60` to passed at `270:120` for both QCLOUD and Direct
  Doubao.
- Local SenseVoice proper-noun correction is useful for stable substitutions,
  as shown by `MES供应商=麦供应商` on `sales-real-004`.

## Goals

- Improve under-transcription and low length ratio in real sales meeting audio.
- Improve industrial software keyword recall without increasing cloud STT
  failures.
- Add before/after benchmark reporting so product changes can be validated
  against the existing private baseline JSON.
- Generate an initial Doubao platform terminology asset for manual import.
- Keep production blast radius small.

## Non-Goals

- Do not modify `/Users/tang-codeing/code/new-api`.
- Do not switch the default STT provider based on the current five-sample data.
- Do not ship QCLOUD parameter fields that remain `ignored_or_unconfirmed`.
- Do not continue request-time Doubao dynamic `context` injection.
- Do not build a new SenseVoice correction configuration management system.
- Do not use Local SenseVoice post-correction to hide raw recognition
  regressions.
- Do not change LLM routing, dynamic actions, RAG, or meeting summary behavior.

## Architecture

The design has three layers.

### 1. Production STT Segmentation Quality Layer

Add a provider-agnostic STT segmentation quality layer around the existing STT
provider calls. It should not be hardcoded to QCLOUD or Local SenseVoice.

Responsibilities:

- Build a bounded segment plan with optional pre-roll / post-roll padding.
- Support full-window, chunks, and overlap modes.
- Transcribe each segment through the existing provider path.
- Merge segment transcripts in chronological order.
- Deduplicate overlap text deterministically.
- Emit diagnostics about segment count, removed duplicate text, suspected
  boundary loss, and partial failures.

This layer is the first production-impacting target because it addresses the
strongest completed test signal without changing provider routing or upstream
infrastructure.

### 2. Benchmark / QA Comparison Layer

Reuse the existing benchmark runners instead of creating a parallel evaluation
system:

- `scripts/run-sales-local-stt-benchmark.mjs`
- `scripts/run-stt-provider-matrix-local.mjs`

Enhance them to compare baseline JSON against after-change JSON and to report:

- average CER
- average length ratio
- average keyword recall
- missing keyword delta
- provider failure rate
- latency delta
- raw segmented transcript metrics
- deduped transcript metrics
- raw vs corrected SenseVoice metrics

Benchmark logic and production segmentation logic should share the same segment
planning, merging, and deduplication helpers. The tests should not prove one
implementation while production uses another.

### 3. Terminology Asset Layer

Generate a first-pass industrial software terminology asset for manual import
into the Doubao platform or backend-managed vocabulary tables.

The repository may include generic industrial software terminology because it
does not contain customer names, company names, project names, people names, or
private meeting text.

The code should support benchmark validation with table ID/name values:

- `boosting_table_id`
- `boosting_table_name`
- `correct_table_id`
- `correct_table_name`

Table ID/name settings should only affect benchmark validation until a future
decision explicitly promotes them into production configuration.

## Data Flow

Production STT flow:

```text
audio buffer / stream
  -> buildSegmentPlan()
  -> transcribe each segment with existing provider
  -> mergeSegmentTranscripts()
  -> dedupeOverlaps()
  -> emit final transcript + diagnostics
```

Benchmark flow:

```text
private real audio + private DOCX reference
  -> same segment plan / merge / dedupe helpers
  -> provider transcription
  -> raw / deduped / corrected comparisons
  -> private report JSON
  -> optional before/after compare report
```

Doubao terminology flow:

```text
generic industrial software terms
  -> generated terminology files
  -> user manually imports into Doubao platform
  -> user provides table ID/name
  -> benchmark validates table ID/name effect
```

## Interfaces

### STT Segmentation

```ts
interface SttSegmentPlan {
  mode: 'full' | 'chunks' | 'overlap';
  sourceStartSec: number;
  sourceDurationSec: number;
  segmentDurationSec: number;
  overlapSec: number;
  segments: SttSegment[];
}

interface SttSegment {
  id: string;
  startSec: number;
  durationSec: number;
  audioStartSec: number;
  audioDurationSec: number;
  overlapBeforeSec: number;
  overlapAfterSec: number;
}

interface SttSegmentTranscript {
  segmentId: string;
  provider: string;
  text: string;
  normalizedText: string;
  transcribeLatencyMs: number;
  providerStatus: 'ok' | 'failed' | 'blocked' | 'skipped';
}

interface SttSegmentationDiagnostics {
  rawText: string;
  dedupedText: string;
  segmentCount: number;
  overlapSec: number;
  rawChars: number;
  dedupedChars: number;
  removedDuplicateChars: number;
  suspectedBoundaryLoss: boolean;
  warnings: string[];
}
```

### SenseVoice Term Correction Diagnostics

```ts
interface SttTermCorrectionDiagnostics {
  enabled: boolean;
  ruleCount: number;
  hitCount: number;
  hits: Array<{ canonical: string; variant: string; count: number }>;
  rawComparison: SttComparison;
  correctedComparison: SttComparison;
  cerDelta: number;
  keywordRecallDelta: number;
}
```

SenseVoice configuration management remains unchanged. This work only improves
benchmark and report observability around existing explicit correction rules.

### Doubao Vocabulary Table Diagnostics

```ts
interface DoubaoVocabularyTableDiagnostics {
  boostingTableId?: string;
  boostingTableName?: string;
  correctTableId?: string;
  correctTableName?: string;
  providerAcceptedFields: string[];
  ignoredOrUnconfirmedFields: string[];
  providerErrorCode?: string;
}
```

## Error Handling

- If one segment STT call fails but other segments succeed, production may return
  the available text with `partial_segment_failure` diagnostics.
- If all segment STT calls fail, return the provider failure instead of masking
  it as an empty transcript.
- If overlap deduplication throws or cannot make a safe decision, fall back to
  raw chronological concatenation and record
  `dedupe_failed_fallback_to_raw_concat`.
- If Doubao table ID/name validation fails, record the provider error code and
  do not fall back to request-time dynamic `context`.
- If SenseVoice correction fails, preserve the raw transcript and mark the
  corrected result as failed. Correction failure must not block STT itself.

## Privacy And Logging

- Do not print full transcripts, prompt text, DOCX content, audio paths, API
  keys, or terminology table content in normal logs.
- Private reports may stay under ignored private directories.
- Default reports should store metric summaries, not full private text.
- Warning logs may include entry id, provider id, status code, metric names, and
  field names.
- Terminology files committed to the repository must contain only generic
  industrial software vocabulary.

## Terminology Asset Scope

The first terminology asset should cover generic industrial software and sales
meeting language across:

- PLM
- QMS
- ERP
- MES
- ALM
- CAD / CAE / CAM
- 3D design software
- Creo
- Windchill
- BOM / ECO / ECR
- APQP / PPAP / SPC / FMEA
- simulation terms such as `流体仿真`, `力学仿真`, `结构仿真`, `热仿真`
- sales discovery terms such as `需求`, `痛点`, `功能`, `案例`, `流程`,
  `图纸`, `审批`, `追溯`, `质量闭环`
- AI agent terms such as `AI 智能体`, `知识库`, `自动化`, `工作流`

The asset must not include customer-specific names.

## Testing

### Unit Tests

- Segment planning:
  - full-window mode
  - chunk mode
  - overlap mode
  - short audio
  - tail clipping
  - invalid overlap greater than or equal to segment duration
  - zero overlap
- Deduplication:
  - repeated short phrase
  - partial overlap
  - no overlap
  - continuous Chinese text
  - fallback when dedupe cannot safely operate
- Partial failure:
  - one segment fails while others succeed
  - all segments fail
- SenseVoice diagnostics:
  - raw and corrected metrics are separate
  - hit count is correct
  - keyword recall delta is correct
- Doubao table diagnostics:
  - table ID/name values enter request metadata
  - provider errors are reported without sensitive data

### Real Data Regression

Use the existing private baseline JSON and real recordings:

- `sales-real-001`
- `sales-real-003`
- `sales-real-004`
- `sales-real-005`
- `sales-real-006`

Compare before and after:

- average CER
- average length ratio
- average keyword recall
- missing keywords
- latency
- provider failure rate

Specific misses to track:

- `sales-real-004`: `MES`
- `sales-real-005`: `ERP`, `流程`, `图纸`
- `sales-real-006`: `功能`

### Acceptance Criteria

- Average CER improves over the current baseline, or at minimum does not
  regress while length ratio and keyword recall improve.
- Average length ratio improves.
- Keyword recall does not regress.
- Provider failure rate does not increase.
- Overlap deduplication does not produce obvious repeated sentences.
- SenseVoice corrected metrics improve only when raw metrics are also preserved.
- Doubao table ID/name validation is reported separately from request-time
  dynamic context.

## Implementation Order

1. Extract shared segmentation plan / merge / dedupe helpers.
2. Wire helpers into the benchmark runner and add before/after compare output.
3. Add unit coverage for segmentation, dedupe, partial failure, and diagnostics.
4. Add Local SenseVoice raw/corrected diagnostics without changing correction
   configuration management.
5. Generate the initial generic industrial software terminology asset.
6. Add Doubao table ID/name validation diagnostics to benchmark reports.
7. Wire the segmentation quality layer into the production STT path behind a
   conservative default.
8. Run existing build and targeted benchmark tests.

## Open Decisions

- The exact production default for overlap duration should start conservative:
  `2s` is the initial candidate because the benchmark runner already supports
  that value.
- Doubao vocabulary table IDs/names are not known until the user manually imports
  the generated terminology asset into the platform.
- A production default provider switch is explicitly out of scope for this spec.
