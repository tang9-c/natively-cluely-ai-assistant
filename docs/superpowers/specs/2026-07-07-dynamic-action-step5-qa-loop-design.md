# Dynamic Action Step 5 QA Loop Design

Date: 2026-07-07

## Summary

Implement Step 5 from `docs/engineering/CONTEXT_SYSTEM_ROADMAP.md`: a local QA loop for real-meeting dynamic action evaluation and product operations.

This is not a backend analytics platform. The first version stays local:

- Add a Settings export action for a user-selected QA support ZIP.
- Add local dynamic action product, replay, and metrics commands.
- Add 120 text fixtures for sales, FDE, and team-meet dynamic action evaluation.
- Generate local JSON/Markdown reports for QA.

No server upload, no visual dashboard, and no automatic telemetry collection beyond the existing local telemetry/logging systems.

## Goals

- Make dynamic action quality measurable instead of relying on ad hoc trigger changes.
- Let QA answer which cards are useful, ignored, failing, slow, or context-dependent.
- Let users export a support package when asked, without engineers visiting their machine.
- Build fixture and report foundations for future replay audio generation.

## Non-Goals

- No backend service.
- No automatic data upload.
- No full visual operations dashboard.
- No generated audio files in this phase.
- No automatic enabling of verbose logging.
- No scanning or exporting raw meeting transcript content from SQLite.
- No new dynamic action behavior, mode, or card UI redesign.

## User-Facing Settings Change

In General Settings, below the existing "Detailed Debug Logs" row, add:

```text
Export Quality Report
Generate a support package with recent quality statistics, telemetry, and debug logs.
[Export]
```

Behavior:

1. User clicks Export.
2. App opens the system save dialog immediately.
3. Default filename:

   ```text
   cueup-qa-report-YYYY-MM-DD.zip
   ```

4. User chooses a location.
5. On success, show a toast:

   ```text
   Quality report exported
   ```

6. On failure, show a toast:

   ```text
   Export failed. Please try again.
   ```

No extra privacy confirmation is shown. No Finder window opens after export. The output path is not copied to the clipboard.

## QA Report ZIP

The ZIP contains data from the last 7 days where possible.

Implementation uses `jszip` as a direct application dependency. Do not rely on
`jszip` only as a transitive dependency of `mammoth`, and do not hand-write ZIP
binary output.

Files:

```text
metadata.json
quality-summary.json
telemetry.jsonl
natively_debug.log
natively_debug.log.1
```

Missing files do not fail the export. They are recorded in `metadata.json`.

### `metadata.json`

Contains:

- app version
- export timestamp
- date range
- platform
- CPU architecture
- whether verbose logging is enabled
- included files
- missing files
- report warnings

### `quality-summary.json`

Contains four Step 5 panel summaries:

1. Mode quality summary
   - grouped by `sales`, `fde`, `team-meet`
   - `shown`, `accepted`, `dismissed`, `expired`, `generated_failed`

2. False positive / false negative summary
   - grouped by action type
   - precision
   - recall
   - defer rate
   - cloud fallback rate

3. Latency summary
   - final transcript to card shown
   - card accepted to first token

4. Trust source summary
   - RAG hit
   - PPTX hit
   - Windchill hit
   - screen used
   - scope denied
   - local fallback

Also includes existing safe answer quality metrics from SQLite when available.

The summary must not include raw transcript, raw prompt, screenshot contents, API keys, provider credentials, or raw meeting summary text.

### Debug Logs

The debug logs are included after export-time redaction.

This means `natively_debug.log` and `natively_debug.log.1` can help support diagnose local QA behavior, but the export service must still remove or redact raw transcript-like text, prompts, screenshots, API keys, tokens, credentials, and other sensitive log fields before writing them into the ZIP. The feature is explicitly a user-initiated support package export and does not upload files automatically.

### Telemetry

Include the local `telemetry.jsonl` for the last 7 days where possible after export-time redaction.

Telemetry already has write-time sanitization. The export service should not rely on telemetry for raw user content and should not enrich it with raw meeting data.

## Services And Boundaries

### `QaReportService`

Electron main process service responsible for creating the ZIP.

Inputs:

- selected save path
- fixed date range: last 7 days

Reads:

- existing local telemetry JSONL
- `~/Documents/natively_debug.log`
- `~/Documents/natively_debug.log.1`
- safe SQLite quality metrics such as `getAnswerQualityMetrics()`

Does not read:

- raw meeting transcript rows for export
- raw prompts
- screenshot content
- provider credentials

Outputs:

- ZIP file at the user-selected path

Dependency:

- `jszip` is listed in `package.json` dependencies and imported directly by
  `QaReportService`.

### `DynamicActionMetricsAggregator`

Pure aggregation helper.

Inputs:

- telemetry records
- dynamic action fixture results
- safe answer quality metrics

Outputs:

- mode quality summary
- action type precision/recall/defer/fallback summary
- latency summary
- trust source summary

### `DynamicActionFixtureRunner`

Reads product fixture manifests and runs dynamic action detection in-process.

It should not call real LLM or STT providers.

Outputs:

```text
reports/dynamic-actions/product-report.json
reports/dynamic-actions/product-report.md
```

### `DynamicActionReplayRunner`

Reads replay manifest structure.

This phase does not generate audio files. When referenced audio files are missing, replay entries are marked as skipped and listed as pending audio generation.

Outputs:

```text
reports/dynamic-actions/replay-report.json
```

## Fixture Assets

Use existing `tests/fixtures/` as the base. Do not create a parallel unrelated fixture system.

Add:

```text
tests/fixtures/dynamic-actions/
  product/
    sales.json
    fde.json
    team-meet.json
  replay/
    replay-manifest.json
```

Text fixture counts:

```text
sales: 50
fde: 40
team-meet: 30
total: 120
```

Each fixture must use the existing `DynamicActionProductFixture` contract from
`electron/services/dynamic-actions/DynamicActionProductFixtures.ts`. Do not add a
second fixture schema for this Step 5 runner.

```json
{
  "id": "sales-pricing-objection-zh-001",
  "modeTemplateType": "sales",
  "language": "zh",
  "transcriptTurns": [
    {
      "speaker": "customer",
      "text": "这个价格有点高，我们预算可能撑不住。",
      "final": true
    }
  ],
  "expected": {
    "shouldEmit": true,
    "actionType": "pricing_objection",
    "outputType": "spoken_response",
    "requiredCardCopy": ["回应价格异议"],
    "forbiddenCardCopy": ["检测到行动项"]
  },
  "tags": ["pricing", "objection", "positive"],
  "sourceRefs": [
    "tests/fixtures/demo/04_mode_reference_files/sales/pricing_objections.md"
  ]
}
```

`tags` and `sourceRefs` are fixture metadata for reporting and traceability. The
runner must validate and execute the typed fields above, then pass results through
the existing `scoreDynamicActionProductFixtures()` scoring helper.

Coverage requirements:

- Sales:
  - price objection
  - pricing request
  - case/proof request
  - technical/integration request
  - buying/progression signal

- FDE:
  - business process discovery
  - system object clarification
  - integration and permission clarification
  - AI Agent feasibility
  - risk/compliance/validation
  - next-step lock-in

- Team meeting:
  - action item
  - deadline
  - decision
  - blocker

Cross-cutting tags:

- Chinese
- English
- mixed Chinese/English
- multi-speaker
- stale topic contamination
- ASR typo
- internal/customer identity mismatch
- negative case

## Commands

Add:

```bash
rtk npm run test:dynamic-actions:product
rtk npm run test:dynamic-actions:replay
rtk npm run test:dynamic-actions:metrics
```

### `test:dynamic-actions:product`

Runs the 120 product text fixtures.

Reports:

- recall
- false positive count and rate
- action type accuracy
- output type accuracy
- per-mode summary
- per-action summary

### `test:dynamic-actions:replay`

Reads replay manifest.

For this phase:

- no audio generation
- missing audio files are skipped
- skipped entries are listed as pending audio generation
- command exits successfully when all missing audio entries are expected skips

### `test:dynamic-actions:metrics`

Tests the metrics aggregator.

It should prove the aggregator can produce:

- mode quality panel data
- false positive / false negative panel data
- latency panel data
- trust source panel data

## Error Handling

- User cancels save dialog: no error toast.
- Telemetry file missing: continue export, add warning.
- Debug log missing: continue export, add warning.
- SQLite quality metrics unavailable: continue export, add warning.
- ZIP write failure: show export failure toast.
- File mtime outside 7 days: omit where practical.
- For large log files, include whole file if the file mtime is inside the 7-day window.

## IPC And UI Contracts

Add IPC/preload/renderer type support for:

```ts
exportQaReport(): Promise<{
  success: boolean;
  filePath?: string;
  error?: string;
  cancelled?: boolean;
}>
```

The renderer does not receive report contents, only export status and selected file path.

## Privacy And Safety

- Export is local and user-initiated.
- No backend upload.
- No automatic telemetry upload.
- `quality-summary.json` must avoid raw user content.
- Debug logs are exported raw by explicit product decision.
- The export code must not read raw meeting transcript tables just to create the support package.
- Existing telemetry sanitization remains required.

## Tests

Add focused tests for:

- IPC/preload/type contract exposes `exportQaReport`.
- Settings source includes the new export row below Detailed Debug Logs.
- `QaReportService` creates a ZIP with `metadata.json` and `quality-summary.json`.
- `package.json` lists `jszip` as a direct dependency for the ZIP export path.
- Missing telemetry/debug log files do not fail export.
- `quality-summary.json` does not contain sentinel transcript, prompt, API key, or screenshot content.
- Fixture manifest has exactly 50 sales, 40 FDE, 30 team-meet entries.
- Product runner reports precision/recall/action accuracy/output accuracy.
- Replay runner marks missing audio as skipped.
- Metrics aggregator creates all four panel summaries.

Verification commands:

```bash
rtk npm run build:electron
rtk npm run typecheck:electron
rtk npm run test:quality:diagnostics
rtk npm run test:dynamic-actions:product
rtk npm run test:dynamic-actions:replay
rtk npm run test:dynamic-actions:metrics
```

## Acceptance Criteria

- User can export a QA support ZIP from General Settings.
- ZIP contains metadata, quality summary, recent telemetry, and available debug logs.
- Export still succeeds when logs are missing.
- No backend or automatic upload is added.
- 120 text fixtures exist and are consumed by `test:dynamic-actions:product`.
- Replay command exists and cleanly reports skipped audio entries.
- Metrics command produces the four Step 5 summary categories.
- Existing quality diagnostics continue to pass.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | — |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR | Fixture schema aligned with `DynamicActionProductFixture`; ZIP dependency pinned to direct `jszip`; no critical gaps remain. |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

**VERDICT:** ENG CLEARED — ready to implement.
