# Unified Performance Baseline Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `npm run perf:baseline:all` as a reliable, resumable entry point that reuses or collects every required performance baseline and fails unless the selected report is complete, independently verified, and privacy-safe.

**Architecture:** Add a testable orchestration library containing argument parsing, the scenario manifest, report validation, resume merging, subprocess sequencing, and final verification. Keep `scripts/run-all-performance-baselines.mjs` as a thin CLI and continue using `runPerformanceBaseline()` for metric aggregation. Existing benchmark scripts remain the measurement owners; the orchestrator supplies output paths and run-count environment variables and serializes all real provider work.

**Tech Stack:** Node.js ESM, `node:test`, existing benchmark scripts, existing `scripts/run-performance-baseline.mjs`, JSON/JSONL reports.

## Global Constraints

- Full acceptance runs only on Apple M4 / 16GB.
- Full mode targets 30 valid samples for each sample-based scenario and one complete 30-minute plus one complete 60-minute long-meeting report.
- Real QCloud scenarios run strictly serially.
- `--quick` targets one sample and skips long meetings; it never overwrites full reports.
- `--resume` tops up valid partial reports without duplicating existing samples; default mode recollects a partial scenario.
- `--only` accepts only `cold-start`, `stt`, `dynamic-action`, `llm`, `rag`, `summary`, `qcloud-stt`, and `long-meeting`.
- Reports must not contain credentials, raw audio, raw transcript, prompts, request/response bodies, dynamic-action evidence, stack traces, or free-form exception messages.
- Never log credential values. Failures use stable stage codes.
- Do not change provider routing or force QCloud STT into streaming mode.
- Do not use `main` as a code source or Git base.

---

## File Structure

- Create `scripts/lib/performanceBaselineOrchestrator.mjs`: pure argument, manifest, validation, merge, privacy, orchestration, and final verification functions.
- Create `scripts/run-all-performance-baselines.mjs`: executable CLI, added only after the orchestration library is complete, that maps results to stdout/stderr and process exit code.
- Create `scripts/__tests__/performance-baseline-orchestrator.test.mjs`: unit and integration-style tests using temporary files and injected subprocesses.
- Modify `scripts/run-performance-baseline.mjs`: export argument parsing if needed and accept injected environment metadata so final report validation uses the orchestrator preflight result.
- Modify `scripts/__tests__/run-performance-baseline.test.mjs`: protect the existing aggregation contract and injected environment behavior.
- Modify `package.json`: register `perf:baseline:all` and the focused test command.
- Modify `docs/product/PERFORMANCE_BASELINE_PRD.md`: change status and usage claims only after all implementation and verification gates pass.

### Task 1: Argument Contract And Scenario Manifest

**Files:**
- Create: `scripts/lib/performanceBaselineOrchestrator.mjs`
- Test: `scripts/__tests__/performance-baseline-orchestrator.test.mjs`

**Interfaces:**
- Produces: `parseOrchestratorArgs(argv): OrchestratorOptions`.
- Produces: `createScenarioManifest({ rootDir, mode }): ScenarioDefinition[]`.
- `OrchestratorOptions` has `mode: 'full' | 'quick' | 'selected'`, `resume: boolean`, and `only: string[] | null`.
- Each `ScenarioDefinition` contains `id`, `runner`, `reportPaths`, `aggregateFlags`, `target`, `countEnv`, `format`, `requiresBuild`, and `requiresCredentials`.

- [ ] **Step 1: Write failing parser and manifest tests**

Add table-driven tests that assert:

```js
assert.deepEqual(parseOrchestratorArgs([]), { mode: 'full', resume: false, only: null });
assert.deepEqual(parseOrchestratorArgs(['--quick']), { mode: 'quick', resume: false, only: null });
assert.deepEqual(parseOrchestratorArgs(['--resume', '--only', 'qcloud-stt,rag']), {
  mode: 'selected', resume: true, only: ['qcloud-stt', 'rag'],
});
assert.deepEqual(parseOrchestratorArgs(['--quick', '--only', 'rag']), {
  mode: 'quick', resume: false, only: ['rag'],
});
assert.throws(() => parseOrchestratorArgs(['--only', 'unknown']), /invalid_scenario_id/);
assert.throws(() => parseOrchestratorArgs(['--wat']), /unknown_option/);
```

Assert that the full manifest has eight stable IDs, full sample targets are 30, long meeting has two report paths, quick targets are 1, and quick long meeting has `excluded: true`. `--only` narrows selected IDs without changing quick-mode output and acceptance semantics.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs`

Expected: FAIL because the orchestrator module does not exist.

- [ ] **Step 3: Implement argument parsing and the frozen manifest**

Implement exact path and environment mappings from the approved design. Reject missing `--only` values, empty comma entries, duplicate IDs, unknown options, and multiple `--only` flags with stable error codes. Export a frozen `SCENARIO_IDS` list and return fresh manifest objects so tests cannot mutate global definitions. When `--quick` and `--only` are both present, retain `mode: 'quick'` and the selected ID list. Do not print or serialize parser error messages; callers consume `OrchestratorError.code`.

- [ ] **Step 4: Run parser and manifest tests**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs`

Expected: parser and manifest tests PASS; orchestration tests do not exist yet.

- [ ] **Step 5: Commit the argument contract**

```bash
git add scripts/lib/performanceBaselineOrchestrator.mjs scripts/__tests__/performance-baseline-orchestrator.test.mjs
git commit -m "feat: define performance baseline manifest"
```

**Task 1 complete when:** every supported mode parses deterministically, invalid input fails before filesystem or network work, and every required scenario maps to its existing runner and report path.

### Task 2: Report Validation, Reuse, And Resume Merge

**Files:**
- Modify: `scripts/lib/performanceBaselineOrchestrator.mjs`
- Modify: `scripts/__tests__/performance-baseline-orchestrator.test.mjs`

**Interfaces:**
- Produces: `readScenarioReport(definition, fileSystem): ParsedScenarioReport`.
- Produces: `validateScenarioReport(definition, parsed, options): ValidationResult`.
- Produces: `decideScenarioAction(definition, validation, { resume }): 'reused' | 'collected' | 'resumed'`.
- Produces: `mergeScenarioReports(definition, existing, additional): MergedReport`.
- Produces: `atomicWriteReport(path, content, fileSystem): Promise<void>`.
- Produces: `loadBaselineState(path): BaselineState` and `writeBaselineState(path, state): Promise<void>` for `reports/performance/m4-16gb/.baseline-state.json`.
- `ValidationResult` includes `valid`, `validSamples`, `target`, `stageCode`, and `sampleValues`.

- [ ] **Step 1: Write failing report-decision tests**

Use temporary JSON and JSONL fixtures. Prove:

```js
assert.equal(validateScenarioReport(coldStart, reportWith30Runs, full).valid, true);
assert.equal(decideScenarioAction(coldStart, valid30, { resume: false }), 'reused');
assert.equal(decideScenarioAction(coldStart, valid12, { resume: false }), 'collected');
assert.equal(decideScenarioAction(coldStart, valid12, { resume: true }), 'resumed');
```

Add one fixture per report shape: `readyMs`, `audioToFinalMs`, `finalTranscriptToCardShownMs`, dual LLM metrics, RAG telemetry records, successful `after` summaries, three QCloud STT timings, and long-meeting CPU/memory/database/renderer samples. Reject malformed JSON, wrong `baselineMachine`, negative or non-finite values, error-only runs, missing 30/60 duration, and fewer valid samples than target.

- [ ] **Step 2: Run tests and verify the validation API is missing**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs`

Expected: FAIL on missing `validateScenarioReport` or equivalent exports.

- [ ] **Step 3: Implement schema-specific sample extraction and decisions**

Create an extractor map keyed by scenario ID. Return only finite non-negative metric values from successful samples. For dual-metric scenarios, a sample is valid only when every required value is present. Long-meeting validity requires the configured duration and at least one valid sample for all five required metrics.

Use stable stage codes including `report_missing`, `report_parse_failed`, `report_machine_mismatch`, `report_schema_invalid`, `report_samples_missing`, and `report_statistics_invalid`.

Validate sidecar entries when present. Each entry contains `schemaVersion: 1`, `scenarioId`, `runnerHash`, `reportHash`, `target`, `mode`, `decision`, and `updatedAt`. A report hash mismatch invalidates that entry. A runner hash mismatch forces only that scenario to collect again. A missing legacy sidecar does not invalidate an otherwise valid report; successful reuse creates its first sidecar entry. Never use Git HEAD as an invalidation key.

- [ ] **Step 4: Write failing resume and atomic-write tests**

Create an existing 12-run report and an 18-run additional report. Assert merged output has exactly 30 samples, preserves report configuration, renumbers display indices, adds opaque `sampleId` values, and leaves the existing source file untouched when validation of the temporary merge fails. For JSONL, assert exactly 30 newline-delimited records. For long meetings, assert merge throws `long_meeting_resume_unsupported`. Add sidecar tests proving a changed runner hash recollects only its scenario, a changed report hash is rejected, and a valid legacy report is reusable before its first sidecar is written.

- [ ] **Step 5: Implement safe merging and atomic replacement**

Assign new samples an ID derived from a random batch ID plus original index. Give legacy samples a SHA-256 ID over canonical sanitized sample data. De-duplicate by `sampleId`, trim only samples beyond the target, write with mode `0o600` to a sibling temporary path, `fsync`, then rename. Apply the same atomic procedure to `.baseline-state.json`. Never mutate the parsed existing object.

- [ ] **Step 6: Run validation and merge tests**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs`

Expected: all Task 1 and Task 2 tests PASS.

- [ ] **Step 7: Commit report reliability logic**

```bash
git add scripts/lib/performanceBaselineOrchestrator.mjs scripts/__tests__/performance-baseline-orchestrator.test.mjs
git commit -m "feat: validate and resume performance samples"
```

**Task 2 complete when:** valid full reports are reusable, partial reports only top up under `--resume`, invalid reports never count toward acceptance, and interrupted writes cannot corrupt the prior report.

### Task 3: Preflight And Serial Collector Orchestration

**Files:**
- Modify: `scripts/lib/performanceBaselineOrchestrator.mjs`
- Modify: `scripts/__tests__/performance-baseline-orchestrator.test.mjs`

**Interfaces:**
- Produces: `inspectBaselineMachine(system): MachineResult`.
- Produces: `buildCollectionPlan(manifest, validations, options): CollectionStep[]`.
- Produces: `executeCollectionPlan(plan, dependencies): Promise<ScenarioExecution[]>`.
- Produces: `runAllPerformanceBaselines(options, dependencies): Promise<OrchestratorResult>` that joins preflight, validation, collection, and the finalization hook implemented in Task 4.
- Consumes injected `dependencies.spawn(command, args, options)`, `dependencies.system`, `dependencies.fileSystem`, and `dependencies.env`.

- [ ] **Step 1: Write failing machine and credential preflight tests**

Assert an `Apple M4` CPU with total memory from 15 through 17 GiB passes, Intel, 8 GiB, and memory outside that inclusive range fail with `preflight_machine_mismatch`, and missing scenario-specific credentials fail with `preflight_credentials_missing`. Assert returned diagnostics contain booleans and variable names only, never configured values.

- [ ] **Step 2: Write failing collection-plan tests**

Given two reusable reports and six missing reports, assert the plan contains only six collectors. In resume mode, assert each count environment variable equals the target deficit. In default mode, assert it equals the full target. Assert Electron build and Vite readiness appear at most once before their dependent collectors.

- [ ] **Step 3: Run tests and verify preflight/planning failure**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs`

Expected: FAIL because preflight and execution functions are missing.

- [ ] **Step 4: Implement preflight and plan construction**

Use `os.cpus()` and `os.totalmem()` through the injected system adapter. Treat memory within normal hardware-reporting tolerance of 16 GiB as valid. Check input fixtures and credentials before build or collection. Build command/argument arrays directly; never use `{ shell: true }`.

Generate long-meeting steps with exact arguments:

```js
['scripts/benchmark-long-meeting-memory.mjs', '--source', 'sensevoice', '--duration-minutes', '30', '--json', tempJson, '--markdown', tempMarkdown]
```

and the corresponding 60-minute step. Other collectors receive a temporary output path as their first positional argument and only the manifest-approved count environment variable.

- [ ] **Step 5: Implement strictly serial execution and signal cleanup**

Execute steps with `for...of` and `await`; do not use `Promise.all`. Capture only exit code and bounded sanitized diagnostics. On SIGINT/SIGTERM, terminate the active child, preserve validated completed reports, remove invalid temporary outputs, and return `collection_interrupted`. Convert subprocess failures to stable `collector_<scenario>_failed` stage codes.

- [ ] **Step 6: Prove real-provider collectors never overlap**

Inject a fake spawn that increments an active counter, delays completion, and records the maximum. Assert `maxActive === 1`, commands follow manifest order, and secret values passed in the environment do not occur in result JSON, stdout summary, or state data.

- [ ] **Step 7: Run orchestration tests**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs`

Expected: all parser, validation, resume, machine, planning, serialization, and interruption tests PASS.

- [ ] **Step 8: Commit collector orchestration**

```bash
git add scripts/lib/performanceBaselineOrchestrator.mjs scripts/__tests__/performance-baseline-orchestrator.test.mjs
git commit -m "feat: orchestrate baseline collectors serially"
```

**Task 3 complete when:** collection starts only after preflight, builds/services are reused once, paid calls cannot overlap, failure output is stage-code-only, and interruption leaves resumable valid state.

### Task 4: Final Aggregation, Independent Verification, And Privacy Gate

**Files:**
- Modify: `scripts/lib/performanceBaselineOrchestrator.mjs`
- Modify: `scripts/run-performance-baseline.mjs`
- Modify: `scripts/__tests__/performance-baseline-orchestrator.test.mjs`
- Modify: `scripts/__tests__/run-performance-baseline.test.mjs`

**Interfaces:**
- Produces: `buildAggregatorOptions(manifest, executions, outputPaths): PerformanceBaselineOptions`.
- Produces: `verifyUnifiedReport(report, sourceReports, expectations): VerificationResult`.
- Produces: `scanReportPrivacy(value, configuredSecrets): PrivacyResult`.
- Extends `runPerformanceBaseline(options)` with optional `environment`, `configuration`, and `metricIds` overrides while preserving current defaults. `metricIds` filters the generated metrics after input mapping so quick/selected reports do not contain unrelated blocked metrics.

- [ ] **Step 1: Write failing output-isolation and aggregation tests**

Assert full, quick, and selected modes resolve respectively to `unified-final`, `unified-quick`, and `unified-selected` JSON/Markdown paths. Inject a fake `runPerformanceBaseline` and assert each selected scenario contributes the correct existing aggregator option, including two long-meeting inputs, plus the exact selected metric IDs. Assert `--quick --only rag` produces only `rag.query`, not unrelated blocked metrics.

- [ ] **Step 2: Write failing independent-verification tests**

Build a source report with values `[10, 20, 30]` and a unified scenario claiming p95 `20`. Assert verification fails with `verification_percentile_mismatch`. Add failures for wrong sample count, p50 greater than p95, missing metric, `blocked`, and non-finite values. Add a passing fixture where the independently calculated nearest-rank p50/p95 match the aggregate report.

- [ ] **Step 3: Write failing privacy tests**

Test recursive keys and string values. Assert rejection of configured secret values, JWT/API-key patterns, base64 audio, transcript/prompt/request/response/evidence keys, stack strings, and free-form error messages. Assert predefined stage codes, paths, counts, machine metadata, hashes, and numeric metrics pass.

- [ ] **Step 4: Run tests and verify aggregation gates are absent**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs scripts/__tests__/run-performance-baseline.test.mjs`

Expected: FAIL on missing final verification and privacy APIs.

- [ ] **Step 5: Implement aggregation and independent verification**

Call the imported `runPerformanceBaseline()` directly instead of spawning another shell. Attach orchestrator metadata under a sanitized configuration field, including mode and scenario decisions. Independently extract source values using Task 2 extractors, sort them, and calculate nearest-rank percentiles without calling `summarizeSamples()`. Compare exact integer metrics and documented rounded floating values.

For quick and selected reports, include only selected metrics and set the top-level mode/status contract explicitly: quick success is `quick-completed`; selected success is `selected-completed`. Full success remains `completed`.

- [ ] **Step 6: Implement the privacy gate and atomic final publication**

Scan source reports, sidecar, and candidate unified JSON before publishing. Render Markdown only after JSON verification succeeds, scan it as text, then atomically publish both files. If any gate fails, retain the previous accepted final report and write only a stage-code state entry.

- [ ] **Step 7: Preserve aggregator compatibility**

Update `runPerformanceBaseline()` so injected environment/configuration merge over existing defaults and `metricIds` filters `buildMetricInputs()` output before `buildPerformanceBaselineReport()`. Add assertions that calling without overrides still records `apple-m4-16gb`, that injected machine data appears only when supplied by the orchestrator, and that omitting `metricIds` preserves all current metrics.

- [ ] **Step 8: Run report and privacy tests**

Run: `node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs scripts/__tests__/run-performance-baseline.test.mjs`

Expected: all focused tests PASS.

- [ ] **Step 9: Commit acceptance gates**

```bash
git add scripts/lib/performanceBaselineOrchestrator.mjs scripts/run-performance-baseline.mjs scripts/__tests__/performance-baseline-orchestrator.test.mjs scripts/__tests__/run-performance-baseline.test.mjs
git commit -m "feat: verify unified performance baseline reports"
```

**Task 4 complete when:** no mode can publish a passing report without matching source samples, correct p50/p95, zero blocked metrics, and a clean privacy scan.

### Task 5: Package Command, Documentation, And End-To-End Acceptance

**Files:**
- Create: `scripts/run-all-performance-baselines.mjs`
- Modify: `package.json`
- Modify: `docs/product/PERFORMANCE_BASELINE_PRD.md`
- Modify: `scripts/__tests__/performance-baseline-orchestrator.test.mjs`

**Interfaces:**
- Consumes: `parseOrchestratorArgs()` and `runAllPerformanceBaselines()` from `scripts/lib/performanceBaselineOrchestrator.mjs`.
- Produces: npm command `perf:baseline:all` and focused test command `test:perf-baseline-orchestrator`.

- [ ] **Step 1: Add the thin CLI**

Create the executable with exactly one call to the completed core:

```js
try {
  const result = await runAllPerformanceBaselines(parseOrchestratorArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result.summary)}\n`);
  process.exitCode = result.ok ? 0 : 1;
} catch (error) {
  process.stderr.write(`${error instanceof OrchestratorError ? error.code : 'orchestrator_unexpected_failure'}\n`);
  process.exitCode = 1;
}
```

Do not print `error.message` or stack traces.

- [ ] **Step 2: Add package scripts**

Add exactly:

```json
"perf:baseline:all": "node scripts/run-all-performance-baselines.mjs",
"test:perf-baseline-orchestrator": "node --test scripts/__tests__/performance-baseline-orchestrator.test.mjs scripts/__tests__/run-performance-baseline.test.mjs"
```

- [ ] **Step 3: Run focused automated acceptance**

Run: `npm run test:perf-baseline-orchestrator`

Expected: all orchestrator and existing aggregator tests PASS with no network requests.

- [ ] **Step 4: Run the quick command on the target machine**

Run: `npm run perf:baseline:all -- --quick --only rag`

Expected: exit `0`; `reports/performance/m4-16gb/unified-quick.json` has mode `quick`, status `quick-completed`, one valid RAG sample, p50/p95, and no long-meeting metrics.

- [ ] **Step 5: Run the full report-first command**

Run: `npm run perf:baseline:all`

Expected on the current Apple M4 / 16GB baseline workspace: existing valid 30-sample and 30/60-minute reports are marked `reused`; no paid collector is launched unnecessarily; `unified-final.json` and `.md` are regenerated; every required scenario is completed with valid p50/p95 and no `blocked`.

- [ ] **Step 6: Verify failure behavior without spending provider calls**

Run the CLI integration test with an injected invalid report and machine adapter rather than renaming real reports. Assert exit code `1`, stable stage code only, and the previous accepted `unified-final.json` hash remains unchanged.

- [ ] **Step 7: Run project regression checks**

Run:

```bash
npm run typecheck:electron
npm test
git diff --check
```

Expected: typecheck exits `0`; the full test suite passes; `git diff --check` emits no output.

- [ ] **Step 8: Update PRD only after every gate passes**

Change status to `已完成`, replace the statement that the command is unavailable with the implemented behavior, and record that full mode may reuse validated reports while reporting each source decision. Do not claim a fresh 30/60-minute run when the command reused historical evidence.

- [ ] **Step 9: Commit the public command and completed PRD**

```bash
git add package.json docs/product/PERFORMANCE_BASELINE_PRD.md scripts/run-all-performance-baselines.mjs scripts/__tests__/performance-baseline-orchestrator.test.mjs
git commit -m "feat: expose unified performance baseline workflow"
```

- [ ] **Step 10: Final repository audit**

Run:

```bash
git status --short
git log -5 --oneline
```

Expected: no unintended source changes; latest commits correspond to the five implementation tasks; generated reports are present only where repository policy permits them.

**Task 5 complete when:** `npm run perf:baseline:all` is documented, automated tests pass, quick selected collection succeeds, the full report-first command produces a complete independently verified report, and the PRD truthfully records the shipped behavior.
