# Sales Real Meeting STT Recognition Optimization Plan

## Summary

Current real-meeting benchmark data is enough to start optimization design, but not enough for a final production default decision. The verified sample set includes `sales-real-XXX`, `sales-real-XXX`, `sales-real-XXX`, `sales-real-XXX`, and `sales-real-XXX`.

The expanded QCLOUD / Direct Doubao validation has been completed and should
not be repeated as a prerequisite for this plan. Reports are stored under the
ignored private benchmark directory:

```text
tests/fixtures/dynamic-actions/replay/private/stt-benchmark/matrix/stt-provider-matrix-1784097760039.json
tests/fixtures/dynamic-actions/replay/private/stt-benchmark/matrix/stt-provider-matrix-1784097884878.json
```

The completed matrix shows that QCLOUD AUC and direct Doubao AUC are effectively
equivalent on the current five-sample set:

- QCLOUD parameter matrix: `passed=6`, `failed=54`, average CER `0.4005`,
  average keyword recall `0.5411`.
- Direct Doubao baseline: `passed=1`, `failed=9`, average CER `0.4011`,
  average keyword recall `0.5467`.
- The best QCLOUD parameter group, `qcloud-current-plus-vad`, only improved
  average CER from `0.3987` to `0.3981` versus `qcloud-current`, with no keyword
  recall gain.
- `qcloud-current-plus-punc-vad` regressed the aggregate result.
- `enable_punc`, `vad_segment`, `enable_ddc`, and `ssd_version` remain
  `ignored_or_unconfirmed` gateway fields and must not be shipped as a proven
  quality fix.

The strongest positive signal is audio windowing, not QCLOUD parameter toggles:
`sales-real-XXX` changed from failed at `300:60` to passed at `270:120` for both
QCLOUD and Direct Doubao. Other recordings did not show a universal longer-window
win, so this points to clipping / segmentation policy work rather than a blanket
parameter switch.

The optimization target is therefore:

- Improve under-transcription / low length ratio.
- Improve industrial software keyword recall.
- Preserve provider reliability and latency.
- Keep Local SenseVoice as a privacy / low-latency option unless quality data proves it should become the default.

## Recommended Optimization Strategy

Based on the completed validation, the optimization should move away from
generic QCLOUD parameter tuning and focus on three concrete workstreams:

1. Audio clipping / segmentation quality layer.

   This is the highest-priority workstream because the strongest test signal was
   windowing. `sales-real-XXX` changed from failed at `300:60` to passed at
   `270:120` for both QCLOUD and Direct Doubao. The implementation should add a
   provider-agnostic STT segmentation quality layer that can:

   - Add bounded pre-roll / post-roll padding to realtime STT chunks.
   - Add 2-3 seconds of overlap between adjacent chunks.
   - Preserve segment metadata, including start time, duration, provider, raw
     transcript length, normalized transcript length, and latency.
   - Merge overlapped transcripts with deterministic de-duplication.
   - Keep both raw segmented transcript and deduped transcript in private
     benchmark reports.
   - Emit under-transcription diagnostics based on length ratio, missing domain
     keywords, and segment boundary loss.

   Do not blindly switch all production runs to a longer window. Other samples
   did not show a universal longer-window win, so padding / overlap must be
   implemented as a controlled segmentation policy with diagnostics.

2. Provider-specific domain terminology support.

   Doubao AUC request-time dynamic industrial corpus context is not viable in
   the current implementation. It produced provider task status `55000001` on
   both QCLOUD and Direct Doubao. The cloud path should therefore use
   platform-managed vocabulary assets instead:

   - Export industrial software hotword / terminology / replacement-word lists.
   - Import those lists into the Doubao platform or backend-managed vocabulary
     tables.
   - Validate only through table ID/name parameters such as
     `boosting_table_id`, `boosting_table_name`, `correct_table_id`, and
     `correct_table_name`.
   - Promote table ID/name configuration only if it improves CER or keyword
     recall without increasing provider failures.

   Until table ID/name validation passes, industrial software terms must remain
   evaluation terms and diagnostics, not fake client-side cloud hotwords.

3. Local SenseVoice proper-noun correction.

   Local SenseVoice should stay available as the privacy / low-latency path, and
   its existing proper-noun correction should be strengthened for stable real
   substitutions. The validated example is `MES供应商=麦供应商`, which changed
   `sales-real-XXX` from failed to passed and improved keyword recall to `1.0`.

   The implementation should:

   - Keep raw recognition metrics and corrected metrics separate.
   - Record correction hit count and corrected keyword recall delta.
   - Apply only explicit, stable correction rules to avoid false corrections.
   - Avoid claiming that correction improves raw acoustic recognition quality.

The first development target should be the provider-agnostic STT segmentation
quality layer, because it benefits QCLOUD, Direct Doubao, and Local SenseVoice
without changing provider routing or upstream infrastructure.

Do not pursue these changes as part of this optimization:

- Do not modify `new-api`.
- Do not switch the default STT provider based on the current five-sample data.
- Do not ship QCLOUD parameter fields that are only `ignored_or_unconfirmed`.
- Do not continue request-time Doubao dynamic `context` injection.
- Do not use Local SenseVoice post-correction to hide raw recognition
  regressions.

## Key Changes

- Do not repeat the completed QCLOUD / Direct Doubao parameter matrix before
  starting optimization.

- Prioritize the smallest production changes supported by the completed data:
  - Improve clipping / realtime segmentation first, because `sales-real-XXX`
    clearly benefited from `270:120`.
  - Evaluate padding / overlap with deterministic de-duplication, but do not
    blindly switch every run to a longer window because other samples did not
    universally improve.
  - Do not promote QCLOUD parameter fields that are only
    `ignored_or_unconfirmed`.
  - Do not change routing from QCLOUD to Direct Doubao based on the completed
    matrix; Direct was not significantly better.
  - Keep Local SenseVoice as a privacy / low-latency path unless broader quality
    data proves it should become the default.

- Track industrial software vocabulary as evaluation terms, not fake client-side hotwords:
  - `PLM,QMS,ERP,MES,ALM,Creo,Windchill,BOM,ECO,ECR,APQP,PPAP,FMEA`
  - `流体仿真,力学仿真,流程,图纸,功能,痛点,案例,质量`
  - Report miss rate per keyword.

- Split domain-term optimization by provider capability:
  - Local SenseVoice uses client-side proper-noun misrecognition correction only. This has been validated on `sales-real-XXX`: correcting the stable variant `麦供应商` to `MES供应商` changed the sample from failed to passed and improved keyword recall from `0` to `1`.
  - Doubao AUC must not use request-time dynamic `context` hotword upload in the current implementation. Direct Doubao AUC and QCLOUD AUC both returned `55000001` when tested with the industrial corpus context on `sales-real-XXX`, `sales-real-XXX`, and `sales-real-XXX`.
  - Doubao AUC should instead export hotword / terminology / replacement-word list files for backend or platform import. After platform import, benchmark with `boosting_table_id` / `boosting_table_name` and `correct_table_id` / `correct_table_name`.

- Keep production blast radius small:
  - Do not modify `new-api`.
  - Do not switch default provider based on the current five-sample result.
  - Do not change dynamic actions, RAG, LLM routing, or meeting summary behavior.
  - Do not count Local SenseVoice term correction as raw recognition quality.
  - Do not ship Doubao AUC dynamic `context` injection unless a future API test proves it is supported.

## Test Plan

Already completed. Do not rerun as a plan prerequisite:

- QCLOUD parameter matrix over `sales-real-XXX,sales-real-XXX,sales-real-XXX,sales-real-XXX,sales-real-XXX`
  with windows `300:60,270:120`.
- Direct Doubao baseline over the same five entries and windows.
- Local SenseVoice availability and explicit correction validation.
- Request-time industrial corpus context validation for QCLOUD and Direct
  Doubao, which failed with provider status `55000001`.

Historical command for the completed QCLOUD matrix:

```bash
rtk npm run test:stt:qcloud-auc:matrix -- --entries sales-real-XXX,sales-real-XXX,sales-real-XXX,sales-real-XXX,sales-real-XXX --windows 300:60,270:120
```

Historical command for the completed Direct Doubao baseline:

```bash
rtk npm run test:stt:provider-matrix:local -- --entries sales-real-XXX,sales-real-XXX,sales-real-XXX,sales-real-XXX,sales-real-XXX --providers direct-doubao-auc --windows 300:60,270:120
```

Next validation should focus on candidate implementation changes, especially
segmentation / overlap behavior:

```bash
rtk npm run test:stt:provider-matrix:local -- --entries sales-real-XXX,sales-real-XXX,sales-real-XXX,sales-real-XXX --providers qcloud-auc,local-sensevoice --parameter-groups qcloud-current --windows 300:60 --segmentation-modes full,overlap
```

Validate domain-term handling:

```bash
# Completed result: request-time corpus context fails with provider status 55000001.
rtk node scripts/run-sales-local-stt-benchmark.mjs --entry sales-real-XXX --provider direct-doubao-auc --industrial-corpus-context --start-sec 300 --duration-sec 60
rtk node scripts/run-sales-local-stt-benchmark.mjs --entry sales-real-XXX --provider qcloud-auc --parameter-group qcloud-current --industrial-corpus-context --start-sec 300 --duration-sec 60

# Completed result: explicit Local SenseVoice correction can improve a stable real misrecognition.
rtk node scripts/run-sales-local-stt-benchmark.mjs --entry sales-real-XXX --provider local-sensevoice --sensevoice-term 'MES供应商=麦供应商' --start-sec 300 --duration-sec 60
```

Candidate optimization acceptance criteria:

- Average CER improves over the current baseline.
- Average length ratio improves over the current baseline.
- Average keyword recall does not regress.
- Miss rate improves for known misses:
  - `sales-real-XXX`: `MES`
  - `sales-real-XXX`: `ERP`, `流程`, `图纸`
  - `sales-real-XXX`: `功能`
- Cloud STT request failure rate does not increase.
- Local SenseVoice reports both pre-correction and post-correction metrics when term correction is enabled.
- Doubao AUC hotword / terminology / replacement-word improvements must be validated with platform table ID/name, not request-time dynamic `context`.

Regression commands:

```bash
rtk npm run build:electron
rtk node --test scripts/__tests__/run-sales-local-stt-benchmark.test.mjs scripts/__tests__/run-sales-team-real-stt-replay.test.mjs
rtk npm run test:dynamic-actions:sales-replay:stt-benchmark:local -- --entry sales-real-XXX --provider qcloud-auc --start-sec 300 --duration-sec 60
```

## Assumptions

- User-provided paths such as `sales-real-XXX.wav` are interpreted as the actual local `.wav` files.
- Five real sales recordings are enough to start optimization design.
- At least 10 real sales recordings are still required before choosing or shipping a production default.
- This optimization work stays client-side and does not modify upstream `new-api`.
- Doubao AUC hotword / terminology / replacement tables are created outside CueUp first; CueUp only exports list files and later references table ID/name for validation.
- QCLOUD parameter groups have already failed to produce a meaningful aggregate
  improvement. The next investigation should focus on audio preprocessing,
  clipping / segmentation, VAD thresholds, capture quality, and provider-specific
  vocabulary table validation.
