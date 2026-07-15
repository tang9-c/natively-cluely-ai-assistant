# QCLOUD / Doubao AUC / Local SenseVoice STT Benchmark Validation Plan

## Summary

This plan validates why CueUp's QCLOUD STT result can be worse than a third-party transcript even when both use Doubao AUC. It also adds Local SenseVoice as a local baseline so the team can compare cloud AUC quality against CueUp's Chinese-first offline STT path.

The goal is not to switch STT models first. The goal is to isolate whether the quality gap comes from request parameters, audio clipping, realtime segmentation, QCLOUD gateway behavior, domain vocabulary handling, or provider choice.

Private real meeting assets must stay local and ignored by Git.

## Completed Validation Results

The requested validation has been completed. Do not rerun these tests just to
re-establish the same baseline.

Validated sample set:

```text
sales-real-XXX
sales-real-XXX
sales-real-XXX
sales-real-XXX
sales-real-XXX
```

Private reports:

```text
tests/fixtures/dynamic-actions/replay/private/stt-benchmark/matrix/stt-provider-matrix-1784097760039.json
tests/fixtures/dynamic-actions/replay/private/stt-benchmark/matrix/stt-provider-matrix-1784097884878.json
```

QCLOUD parameter matrix result:

- 60 QCLOUD AUC cases were measured across 5 real sales recordings, 2 audio
  windows, and 6 parameter groups.
- Aggregate status: `passed=6`, `failed=54`, `blocked=0`, `skipped=0`.
- Average CER: `0.4005`.
- Average keyword recall: `0.5411`.
- The best aggregate QCLOUD group was `qcloud-current-plus-vad`, but the
  difference from `qcloud-current` was negligible:
  - `qcloud-current`: average CER `0.3987`, average keyword recall `0.5467`.
  - `qcloud-current-plus-vad`: average CER `0.3981`, average keyword recall
    `0.5467`.
- `qcloud-current-plus-punc-vad` regressed the aggregate result:
  average CER `0.4060`, average keyword recall `0.5133`.
- `enable_punc`, `vad_segment`, `enable_ddc`, and `ssd_version` were reported
  as `ignored_or_unconfirmed` by the benchmark reports, so they are not proven
  to be active QCLOUD gateway controls.

Direct Doubao AUC baseline result:

- 10 Direct Doubao AUC cases were measured across the same 5 real sales
  recordings and 2 audio windows.
- Aggregate status: `passed=1`, `failed=9`, `blocked=0`, `skipped=0`.
- Average CER: `0.4011`.
- Average keyword recall: `0.5467`.
- Direct Doubao and QCLOUD gateway quality were effectively equivalent on this
  sample set. The current evidence does not support treating the QCLOUD gateway
  as the main quality-loss source.

Audio window result:

- The strongest positive signal came from audio windowing, not provider
  parameter toggles.
- `sales-real-XXX` changed from failed at `300:60` to passed at `270:120` for
  both QCLOUD and Direct Doubao.
- Other recordings did not show a universal win from the longer window, so
  padding / overlap must be validated as a targeted segmentation and clipping
  fix, not a blanket quality solution.

Local SenseVoice result:

- The local SenseVoice model was detected as available.
- Local SenseVoice custom term correction was validated on `sales-real-XXX`.
- The rule `MES供应商=麦供应商` changed that sample from failed to passed and
  improved keyword recall to `1.0`.
- This proves the client-side proper-noun correction path can help stable
  domain-term substitutions, but corrected metrics must stay separate from raw
  recognition quality.

Domain vocabulary result:

- Request-time dynamic industrial corpus context must remain disabled for
  Doubao AUC in the current implementation.
- Direct Doubao AUC and QCLOUD AUC both returned provider task status
  `55000001` when tested with industrial corpus context on
  `sales-real-XXX`, `sales-real-XXX`, and `sales-real-XXX`.
- Doubao AUC vocabulary optimization should use platform-managed hotword /
  terminology / replacement tables, then validate by table ID/name.

## Fixed Baseline Assets

Use the local private sales replay pairs:

```text
tests/fixtures/dynamic-actions/replay/audio/real/sales/sales-real-XXX.wav
tests/fixtures/dynamic-actions/replay/transcripts/real/sales/sales-real-XXX.docx

tests/fixtures/dynamic-actions/replay/audio/real/sales/sales-real-XXX.wav
tests/fixtures/dynamic-actions/replay/transcripts/real/sales/sales-real-XXX.docx
```

The first benchmark commands are:

```bash
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 300 --duration-sec 60
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 300 --duration-sec 60
```

The benchmark runner should support an explicit provider selector:

```bash
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --provider qcloud-auc --start-sec 300 --duration-sec 60
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --provider local-sensevoice --start-sec 300 --duration-sec 60
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --provider qcloud-auc --start-sec 300 --duration-sec 60
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --provider local-sensevoice --start-sec 300 --duration-sec 60
```

Reports must be written under the ignored private directory:

```text
tests/fixtures/dynamic-actions/replay/private/stt-benchmark/
```

## Metrics

Each run must report:

- `characterErrorRate`
- `similarity`
- `lengthRatio`
- `keywordRecall`
- `missingKeywords`
- `referenceAlignmentStatus`
- `bestReferenceOffsetSec`
- `provider`
- `providerConfig`
- `providerStatus`
- `environmentStatus`
- `providerErrorCode`
- `providerErrorType`
- `parameterGroup`
- `gatewayFieldStatus`
- `unsupportedFields`
- `ignoredOrUnconfirmedFields`
- `clipStartSec`
- `clipDurationSec`
- `transcribeLatencyMs`
- `audioDurationSec`
- `localModelStatus`

Initial pass thresholds:

```text
characterErrorRate <= 0.35
keywordRecall >= 0.75
lengthRatio >= 0.75
referenceAlignmentStatus = aligned
```

Thresholds can be refined after at least 10 real sales recordings have been measured.

Provider-specific notes:

- QCLOUD / Doubao AUC can support cloud-side punctuation, utterances, and speaker metadata depending on gateway behavior.
- Local SenseVoice runs locally and must not be expected to provide cloud AUC-style speaker separation. It should be judged on transcript text quality, latency, privacy, and domain term behavior.
- Local SenseVoice term correction is post-recognition correction. It can fix stable known substitutions but must not be counted as acoustic recognition improvement unless reported separately.

## Phase 1: Audio Window Experiment

Purpose: determine whether the current gap is caused by clipping too tightly.

Run the same entry with multiple windows:

```bash
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 300 --duration-sec 60
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 290 --duration-sec 80
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 280 --duration-sec 100
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 270 --duration-sec 120

rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 300 --duration-sec 60
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 290 --duration-sec 80
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 280 --duration-sec 100
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --start-sec 270 --duration-sec 120
```

Decision rule:

- If longer windows lower CER and improve length ratio, clipping context is a major factor.
- If longer windows still under-transcribe, focus on request parameters and segmentation.

## Phase 2: QCLOUD AUC Parameter Matrix

Purpose: determine whether QCLOUD gateway parameters are causing lower quality than direct Doubao AUC usage.

Current QCLOUD multipart fields:

```text
model=bigmodel
enable_speaker_info=true
enable_emotion_detection=true
show_utterances=true
enable_itn=true
```

Candidate fields to test:

```text
enable_punc=true
vad_segment=true
enable_ddc=false
ssd_version=200
```

Required parameter groups:

1. Current QCLOUD parameters.
2. Current parameters + `enable_punc`.
3. Current parameters + `vad_segment`.
4. Current parameters + `enable_punc` + `vad_segment`.
5. Current parameters + `ssd_version=200`.
6. Parameters aligned with the existing direct Doubao AUC request shape.

Decision rule:

- Completed result: no QCLOUD parameter group improved the multi-sample report
  enough to justify production promotion.
- Completed result: fields such as `enable_punc`, `vad_segment`,
  `enable_ddc`, and `ssd_version` were recorded as
  `ignored_or_unconfirmed`, not proven active gateway controls.
- Do not ship these fields as a quality fix based on the completed matrix.

Each parameter-matrix report must include:

```json
{
  "parameterGroup": "qcloud-current-plus-punc-vad",
  "gatewayFieldStatus": {
    "enable_punc": "accepted",
    "vad_segment": "accepted",
    "enable_ddc": "accepted",
    "ssd_version": "unsupported"
  },
  "unsupportedFields": ["ssd_version"],
  "ignoredOrUnconfirmedFields": []
}
```

Allowed field statuses:

```text
accepted
unsupported
ignored_or_unconfirmed
not_sent
```

## Phase 3: Direct Doubao AUC vs QCLOUD Gateway

Purpose: separate model quality from gateway behavior.

Run the same clipped audio through:

1. QCLOUD gateway AUC endpoint.
2. Direct Doubao AUC endpoint.

Environment status rules:

- Missing QCLOUD credentials must report `blocked_missing_qcloud_credentials`.
- Missing direct Doubao AUC credentials must report `blocked_missing_direct_doubao_credentials`.
- Missing Local SenseVoice model must report `blocked_missing_local_sensevoice_model`.
- Blocked provider runs must exit successfully for matrix orchestration, but the report status must be `blocked`, not `passed`.
- Final aggregate reports must count `passed`, `failed`, `blocked`, and `skipped` separately.

Decision rule:

- Completed result: Direct Doubao was not significantly better than QCLOUD.
- Focus next on audio clipping / segmentation, vocabulary table validation, and
  local SenseVoice correction behavior.

## Phase 4: Local SenseVoice Baseline

Purpose: compare CueUp's local Chinese-first STT path against cloud AUC on the same private real audio and reference transcript.

Run the same clipped audio through:

1. QCLOUD gateway AUC.
2. Direct Doubao AUC, when direct credentials are available.
3. Local SenseVoice without term correction.
4. Local SenseVoice with the existing configured term correction.

Required local checks:

- SenseVoice model is installed and loadable.
- The run reports `localModelStatus`.
- The run reports whether term correction was enabled.
- Raw audio and transcript text stay local.
- No API key is required for the local provider.

Decision rule:

- Completed result: Local SenseVoice is available and custom term correction can
  fix stable real substitutions, as shown by `sales-real-XXX`.
- Current evidence is not enough to make Local SenseVoice the quality-first
  default for Chinese sales meetings.
- Keep corrected and uncorrected metrics separate.
- Keep Local SenseVoice as a privacy / low-latency option unless broader
  quality data proves it should become the default.

Local SenseVoice comparison must not claim speaker separation parity with AUC unless the implementation actually provides it.

## Phase 5: Realtime Segmentation and VAD Experiment

Purpose: validate whether production realtime splitting hurts STT quality.

Compare:

1. One complete 60 second submission.
2. Simulated production-style segments, for example 10 second chunks.
3. Segments with 1.5 to 3 seconds overlap.

Check:

- Does segmenting increase CER?
- Are sentence beginnings or endings missing?
- Do domain terms disappear after segmentation?
- Does overlap recover missed text without unacceptable latency?

Segmentation scoring rules:

- Each segment run must report segment start, duration, provider, raw transcript length, normalized transcript length, and latency.
- Non-overlap segmented output is scored both per segment and after concatenating segments in chronological order.
- Overlap segmented output must keep segment timestamps and perform deterministic de-duplication before whole-window scoring.
- De-duplication should prefer the later segment's text when the overlap region contains near-duplicate text, because the later segment has more right-side acoustic context.
- Reports must include both `segmentedRawComparison` and `segmentedDedupedComparison` for overlap runs.
- Whole-window full-audio comparison remains the baseline. Segmented runs must be compared against the same DOCX reference window as the full-window run.

Required segmentation report fields:

```json
{
  "segmentationMode": "overlap",
  "segmentDurationSec": 10,
  "overlapSec": 2,
  "segments": [
    {
      "startSec": 300,
      "durationSec": 10,
      "transcribeLatencyMs": 1200,
      "normalizedChars": 52
    }
  ],
  "segmentedRawComparison": {},
  "segmentedDedupedComparison": {},
  "wholeWindowBaselineComparison": {}
}
```

Decision rule:

- If full-window STT is good but segmented STT is poor, optimize VAD, overlap, and flush policy first.
- If full-window STT is also poor, prioritize parameter matrix and vocabulary support.

Run segmentation tests per provider:

- QCLOUD AUC segmented vs full-window.
- Local SenseVoice segmented vs full-window.

This matters because the local provider and cloud provider may react differently to short chunks and overlap.

## Phase 6: Domain Vocabulary / Term Correction Experiment

Purpose: verify whether industrial software vocabulary support improves recognition.

Initial vocabulary:

```text
PLM, QMS, ERP, MES, ALM, Creo, Windchill,
BOM, ECO, ECR, APQP, PPAP, FMEA,
流体仿真, 力学仿真, 结构仿真,
质量闭环, 变更管理, 追溯, 案例, AI, 智能体
```

Decision rule:

- Direct Doubao AUC and QCLOUD AUC request-time dynamic `context` must be treated as unsupported unless future API evidence proves otherwise. The completed benchmark result is that adding the industrial corpus context caused provider task status `55000001` on `sales-real-XXX`, `sales-real-XXX`, and `sales-real-XXX`.
- Doubao AUC hotword / terminology / replacement optimization should use platform-managed tables: export list files, import them into the Doubao platform/backend, then validate with `boosting_table_id` / `boosting_table_name` and `correct_table_id` / `correct_table_name`.
- If table ID/name improves metrics without increasing failures, add a provider-level configuration for those IDs/names.
- If table ID/name is unsupported or ineffective, do not add fake client-side hotword logic. Keep vocabulary misses as diagnostics.
- For Local SenseVoice, evaluate the existing term correction path separately:
  - uncorrected Local SenseVoice output
  - corrected Local SenseVoice output
  - correction hit count
  - corrected keyword recall delta
  - false correction examples, if any
  - stable explicit correction rules such as `MES供应商=麦供应商`

Do not use term correction to hide core recognition regressions. Reports must keep pre-correction and post-correction metrics separate.

Current validated example:

```bash
rtk node scripts/run-sales-local-stt-benchmark.mjs --entry sales-real-XXX --provider local-sensevoice --sensevoice-term 'MES供应商=麦供应商' --start-sec 300 --duration-sec 60
```

This changed `sales-real-XXX` Local SenseVoice from failed to passed, with keyword recall improving from `0` to `1`.

## Phase 7: Multi-Sample Validation

After the script works on `sales-real-XXX` and `sales-real-XXX`, run at least 10 real sales recordings:

```text
sales-real-XXX ... sales-real-XXX
```

For each entry, run:

- current QCLOUD production parameter group
- best QCLOUD candidate parameter group
- Local SenseVoice without term correction
- Local SenseVoice with term correction
- 60 second window
- 120 second window

The final report must include:

- average CER
- P50 / P95 CER
- average keyword recall
- P50 / P95 length ratio
- miss rate per domain keyword
- best parameter group per recording
- best provider per recording
- Local SenseVoice uncorrected vs corrected delta
- STT request failure rate
- submit/query latency summary
- local inference latency summary

## Production Acceptance Criteria

Only ship a STT parameter or segmentation change if:

- at least 10 real sales recordings were measured
- average CER improves over the current production group
- keyword recall does not regress
- STT request failure rate does not increase
- submit/query latency does not materially worsen
- QCLOUD gateway does not introduce new 4xx / 5xx failures
- realtime segmentation changes do not noticeably worsen UI latency
- Local SenseVoice changes do not hide errors by only reporting post-correction text
- provider default changes explicitly consider privacy, latency, speaker separation availability, and accuracy

## Proposed Follow-Up Command

After the first benchmark script is stable, add a matrix runner:

```bash
rtk npm run test:stt:qcloud-auc:matrix -- --entry sales-real-XXX
rtk npm run test:stt:qcloud-auc:matrix -- --entries sales-real-XXX,sales-real-XXX,sales-real-XXX
rtk npm run test:stt:provider-matrix:local -- --entry sales-real-XXX --providers qcloud-auc,local-sensevoice
rtk npm run test:stt:provider-matrix:local -- --entries sales-real-XXX,sales-real-XXX,sales-real-XXX --providers qcloud-auc,local-sensevoice
```

The matrix runner must also write reports only to ignored private paths.
