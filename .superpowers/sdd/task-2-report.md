# Task 2 Report: Shared Runtime Validation Policy and Dual Evidence Contract

## Status

- Completed on branch `ci/intel-mac-workflow`.
- Functional commit: `1e2b7fc3 feat(recruiting): separate policy and transcript evidence validation`.
- Scope is limited to the Task 2 brief files. The pre-existing untracked `.tmp/` directory was not touched.

## Implementation

- Added one pure `DynamicActionRuntimeValidationPolicy` data/helper module. It maps capability and FDE answers to external capability evidence, `candidate_concern` to external recruiting-policy evidence, and the future `candidate_evidence_summary` derived action to transcript evidence.
- Added explicit context decisions: candidate policy responses require material but never business/screen context; candidate evidence summaries require no external context.
- Restricted recruiting policy grounding to injected material/PPTX evidence. Transcript-evidence actions expose no external grounded sources.
- Made claim verification domain-aware for capability versus recruiting-policy claims. Transcript-evidence actions bypass the external verifier.
- Added deterministic recruiting evaluators, bounded IPC transcript evidence (`latestTurn` and `retrievalQuery`, 1200 characters each), and separate policy/evidence safe fallbacks.
- Preserved capability-fit and FDE evidence behavior and their safe-fallback text through the shared policy helper.

## RED Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/services/__tests__/ContextNeedDecision.test.mjs electron/services/__tests__/DynamicActionRuntimeGrounding.test.mjs electron/services/__tests__/DynamicActionRuntimeEvaluation.test.mjs
```

Before implementation, TypeScript compiled and the focused suite failed in four expected places:

- `candidate_concern` incorrectly reported material as `not_needed`.
- The shared runtime policy module was absent.
- An ungrounded recruiting-policy claim passed evaluation.
- An unsupported candidate evidence summary passed evaluation.

## GREEN Evidence

The same focused command passed after implementation:

- Electron TypeScript compilation passed.
- 11 focused tests passed, 0 failed.
- Existing evaluator and claim-verifier regression suite also passed: 8 tests, 0 failed.
- `git diff --check` passed before staging and the cached diff check passed before the functional commit.

## Privacy and Review

- The IPC contract never receives `evidenceRefs`; it constructs only bounded values from the already-sanitized mode event.
- Transcript evidence and injected excerpts are not added to usage metadata or runtime evaluation traces. Those retain only action identifiers, source statuses, verdicts, and failure codes.
- Code-review graph change analysis reported risk 0.40 with no affected flows. Manual review confirmed no new service/class, persistence, provider call for transcript evidence, IPC channel, or cycle.

## Concerns

- `candidate_evidence_summary` is intentionally only a Task 2 runtime contract. Task 3 remains responsible for producing that derived action.

## Reviewer Follow-up: Transcript Privacy and Recruiting Boundaries

### Implementation

- `IntelligenceEngine.recordDynamicActionUsage()` now emits a minimal metadata shape for the `transcript_evidence` policy. It omits `retrievalQuery`, mode context, and source content while retaining action identity, `evidenceKind`, output type, and generation status.
- Completed transcript-evidence runtime usage follows the same boundary. It records action identity, `evidenceKind`, evaluation result, and claim-grounding verdict/reason, but not `latestTurn`, `retrievalQuery`, transcript evidence, source intent, or grounded excerpts.
- The evaluator keeps transcript evidence in memory for the bounded runtime validation only. The new tests prove it still receives and validates the supplied evidence while the external claim verifier is bypassed.
- Recruiting safety checks are now maintained in separate categories: visible method classification, final hiring judgments, and externally grounded policy claims. They reject Chinese and English stress-interview classification, non-advancement judgments, unsupported start-date commitments, and unsupported offer commitments without matching ordinary high-pressure project evidence.

### RED Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/services/__tests__/DynamicActionRuntimeEvaluation.test.mjs
```

Before the reviewer fix, the build passed and five runtime tests failed as expected:

- Accepted and completed transcript-evidence metadata had no `evidenceKind` privacy shape.
- Stress-interview method classification was accepted.
- Final non-advancement judgments were accepted.
- Start-date and offer policy claims did not consistently produce the recruiting-material grounding failure.

### GREEN Evidence

- The same Electron TypeScript build plus runtime evaluation command passed: 12 tests, 0 failures.
- `rtk node --test electron/services/__tests__/ModeEventClassifier.test.mjs` passed: 18 tests, 0 failures.
- `git diff --check` passed before staging.

### Cloud Gate Ordering Evidence

- No second cloud gate was added. `IntelligenceEngine.runWhatShouldISay()` invokes the grounded-claim verifier only when a caller has already supplied `dynamicActionValidation`; it does not create or authorize an action.
- The existing `partial invalid cloud JSON defers every required recruiting candidate without fallback` test in `electron/services/__tests__/ModeEventClassifier.test.mjs` proves that a failed/partial cloud semantic gate returns `defer` with `cloud_invalid_json` for every required recruiting candidate.
- Therefore a failed cloud gate yields no approved recruiting action for the runtime path to validate. The claim verifier remains post-action grounding validation with its existing timeout and provider-routing behavior.

## Second Reviewer Follow-up: Cloud Boundary and Fail-Closed Recruiting

### Implementation

- Code commit: `f17376c4 fix(recruiting): enforce cloud gate and fail-closed policy`.
- Added the backward-compatible `StructuredGenerationOptions.requireCloudProvider` boundary. Its default remains `false`, preserving the existing Codex CLI, Ollama, custom, and cURL structured-generation fallbacks.
- With `requireCloudProvider: true`, structured generation admits only explicitly remote OpenAI, Claude, Gemini, Doubao, and QCLOUD providers. Codex CLI, Ollama, custom providers, and cURL providers are not inspected or invoked. Cloud-only provider errors are reduced to `provider_timeout` or `provider_request_failed`, so an upstream error cannot echo prompt/transcript content into logs or diagnostics.
- `IntelligenceEngine.classifyDynamicActionWithCloud()` now sets `requireCloudProvider: true`. No cloud provider or exhaustion throws through the existing `CloudSemanticGateError` mapping; `ModeEventClassifier` then applies the existing required-action defer policy instead of authorizing a local semantic result.
- `candidate_concern` is fail-closed. Only an explicit recruiting-material insufficiency answer that also directs the user to a recruiter/hiring team may skip claim verification. Every other answer requires both a used recruiting material/PPTX source and a `supported` claim-grounding verdict.
- The claim verifier uses the same safe-insufficiency exception. It no longer treats an answer as unverified merely because it is absent from a positive-policy keyword list.
- Recruiting safety rules remain separated into method classification, final hiring judgment, protected-class basis, and aggressive pressure categories. Table-driven Chinese/English tests cover stress-test classification, hire/not-fit judgments, nationality, same-day offer pressure, and ordinary evidence false-positive guards.

### RED Evidence

The first focused run compiled and then failed 7 of 50 tests: cloud-only invoked Codex CLI, the semantic-gate option was absent, local-only recruiting was not deferred at the provider boundary, substantive recruiting answers skipped verification, and the new safety equivalents were accepted.

A second table-driven RED run failed the pressure-interview variant and showed that the old unbounded English `age`/`race` alternatives misclassified `managed`/`traced` evidence. After fixing those, a final RED sentinel test proved provider errors could echo prompt content into the cloud-only exception and warning log.

### GREEN Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/llm/__tests__/LLMHelper.StructuredGeneration.test.mjs electron/services/__tests__/ContextNeedDecision.test.mjs electron/services/__tests__/DynamicActionRuntimeGrounding.test.mjs electron/services/__tests__/DynamicActionRuntimeEvaluation.test.mjs electron/services/__tests__/DynamicActionClaimGroundingVerifier.test.mjs electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs electron/services/__tests__/ModeEventClassifier.test.mjs
```

- Electron TypeScript compilation passed.
- 73 tests passed, 0 failed across the reviewer coverage and original Task 2 focused suites.
- Default structured generation still used Ollama; cloud-only generation invoked none of Ollama, Codex CLI, custom, or cURL providers and did not leak a provider-echoed prompt sentinel.
- The local-only recruiting engine test emitted no `candidate_concern`. The existing `partial invalid cloud JSON defers every required recruiting candidate without fallback` test also remained green, proving the verifier cannot become an action-entry path after cloud-gate failure.

### Call Order and Record Boundary

- The action-entry order is: `IntelligenceEngine.classifyDynamicActionWithCloud()` -> cloud-only `generateContentStructured()` -> `CloudSemanticGateError` on unavailable/invalid cloud -> `ModeEventClassifier` defer for required recruiting actions. `DynamicActionClaimGroundingVerifier.verify()` is reached only later from accepted-answer runtime validation and cannot create or authorize an action.
- `candidate_evidence_summary.visibleAnswer` remains unchanged. Task 2 requires its accepted answer to be evaluated against bounded in-process transcript evidence; Task 4 Step 3 explicitly stores the accepted `structuredSummary` in internal recruiting records, caps summaries to 180 characters, and forbids retaining extra raw transcript. Task 4 Step 4 keeps those records in internal coaching and excludes them from candidate-facing follow-up drafts.
- This internal accepted-answer record is distinct from raw transcript evidence. The existing metadata tests remain green and prove `latestTurn`, `retrievalQuery`, transcript evidence, and excerpts are absent from usage metadata and runtime diagnostics.

### Concerns

- None. The default structured-generation route and existing capability/FDE evaluator behavior are unchanged.

## Final Reviewer Follow-up: Evaluator Escape Closure

### Implementation

- Code commit: `f2f83d2d fix(recruiting): close evaluator escape paths`.
- Replaced the phrase-based recruiting insufficiency exception with `isExactRecruitingPolicySafeFallback()`. After Unicode and whitespace normalization, an ungrounded answer passes only when it equals the Chinese or English output of `buildRecruitingPolicySafeFallback()`. Prefixes, suffixes, policy commitments, and paraphrases fail closed.
- Confirmed the runtime order in `IntelligenceEngine.runWhatShouldISay()`: the model answer is verified and evaluated before fallback substitution. An escaped raw answer therefore fails evaluation and is replaced by the existing deterministic fallback; no paraphrase exception was added.
- Split recruiting safety into four independent helpers: visible interview method classification, final hiring judgment/ranking, aggressive recruiting pressure, and protected-class basis. Protected attributes are rejected only when the same statement links them to suitability, a hiring decision, or work impact. Explicit statements excluding age or another attribute from hiring remain allowed.
- English transcript anchors now remove common function-word stopwords. Numeric and percentage claims additionally require the same normalized numeric anchor in transcript evidence, while still requiring a shared nonnumeric action/entity anchor. The existing Chinese tokenization path remains intact.

### RED Evidence

The first TDD run compiled and failed 6 tests for the intended reasons:

- deterministic fallback plus a permanent-remote or offer commitment was treated as safe by both evaluator and verifier;
- runtime returned the escaped model answer instead of substituting the deterministic fallback;
- `Current method is structured interview` was not classified;
- the protected-class keyword rule rejected an explicit safe exclusion statement;
- `led the 50-person team` passed against unrelated transcript evidence solely through shared stopwords.

### GREEN Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/services/__tests__/DynamicActionRuntimeEvaluation.test.mjs electron/services/__tests__/DynamicActionClaimGroundingVerifier.test.mjs electron/llm/__tests__/LLMHelper.StructuredGeneration.test.mjs electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
```

- Electron TypeScript compilation passed.
- 53 tests passed, 0 failed.
- Table-driven coverage includes every reviewer probe, protected-class safe counterexamples, unrelated English stopword evidence, real shared action/entity evidence, and matching/mismatching percentages.
- Cloud-only structured generation, prompt-log privacy, and local-only recruiting defer tests remained green.
- Code-review graph reported no affected execution flow; manual review covered the `.mjs` tests that the graph did not associate with the TypeScript evaluator.

### Concerns

- None. This round changes only the evaluator and its two focused test files; `.tmp/` remains untouched.

## Final Sentence-Level Safety Findings

### Implementation

- Code commit: `d79427f2 fix(recruiting): enforce sentence-level safety exclusions`.
- Final judgment/ranking now evaluates each sentence independently. It covers subjectless and imperative forms including `Definitely hire this candidate`, `Reject this candidate`, `直接录用`, and `淘汰她`, while preserving the existing should-hire, not-a-fit, rank-first, and plan-language checks.
- A sentence that explicitly prohibits a final judgment, such as `不要直接录用` or `不得据此淘汰`, is excluded from final-judgment matching. The exclusion applies only to that sentence.
- Protected-class basis uses the same sentence-local structure. It first recognizes explicit exclusions (`does not affect hiring`, `不应影响录用`, `不得将宗教作为录用依据`) and otherwise checks the attribute/relationship pair.
- Added protected-class relationships for `Too old for the role`, `Marital status is a concern`, `Religion makes the candidate unstable`, and `宗教原因不稳定`, while retaining women-not-suitable, 女性不适合, and 已婚影响 checks.
- Mixed answers remain fail-closed: a safe exclusion sentence does not hide a separate sentence that actually uses age or religion as a hiring basis.

### RED Evidence

The TDD run compiled and then failed the table-driven unsafe case at `Definitely hire this candidate`; the safe table also failed because `age does not affect hiring` was still interpreted as a protected-class causal claim. These failures confirmed both missing sentence-level branches before production edits.

### GREEN Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/services/__tests__/DynamicActionRuntimeEvaluation.test.mjs electron/services/__tests__/DynamicActionClaimGroundingVerifier.test.mjs
```

- Electron TypeScript compilation passed.
- 21 tests passed, 0 failed.
- Every reviewer probe appears verbatim in the positive/negative tables, including mixed safe-plus-unsafe answers.
- Code-review graph reported risk 0.00 with no affected flow or indexed test gap.

### Concerns

- None. `.tmp/` remains untouched.

## Same-Sentence Contrast Bypass Fix

### Implementation

- Code commit: `66f6a290 fix(recruiting): split safety checks at contrast clauses`.
- Replaced sentence-only safety iteration with `splitRecruitingSafetyClauses()`: text is first split at the existing sentence boundaries, then at explicit English and Chinese contrast connectors (`but`, `however`, `yet`, `但`, `但是`, `然而`, `不过`, `却`).
- Final-judgment exclusion and protected-class exclusion now apply only to the current clause. A safe first clause cannot suppress an unsafe clause after a contrast connector.
- Kept the existing pure safe sentence behavior and added one narrow final-judgment pattern for `最终还是直接录用她`.

### RED Evidence

The TDD run compiled and failed at `Do not hire based on this alone, but definitely hire this candidate.` because the first clause's prohibition short-circuited the entire sentence. After clause splitting, the next RED exposed the narrow Chinese form `最终还是直接录用她`, which was then covered without broadening to arbitrary uses of `录用`.

### GREEN Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/services/__tests__/DynamicActionRuntimeEvaluation.test.mjs electron/services/__tests__/DynamicActionClaimGroundingVerifier.test.mjs
```

- Electron TypeScript compilation passed.
- 21 tests passed, 0 failed.
- All five verbatim contrast probes are rejected; the existing pure safe final-judgment and protected-class exclusions still pass.
- Code-review graph reported risk 0.00 with no affected flow or indexed test gap.

### Concerns

- None. `.tmp/` remains untouched.

## Task 2: validator 完整性校验（speakers / scenarios / segments / 覆盖率 / 反向）

### Status

- DONE
- Branch: `ci/intel-mac-workflow`
- Functional commit: `539fbe52 feat(validator): enforce fixture integrity for sales transcript`
- Scope limited to brief-specified files: `tests/utils/sales-transcript-fixture-validator.mjs` and `tests/utils/__tests__/sales-transcript-fixture-validator.test.mjs`.

### Implementation

- Appended three new failing tests verbatim from the brief: `detects duplicate speaker ids`, `detects scenario overlap`, `coverage report counts intent occurrences`.
- Extended `validateSalesTranscriptFixture` in place (no replacement of existing top-level key check). Inserted the new validation blocks immediately above the final `return { ok: errors.length === 0, errors, warnings, coverageReport }`.
- New checks: speaker-id uniqueness, role whitelist (`user`/`customer`/`internal`), scenario overlap detection by `start_ms < previous.end_ms`, scenario `expected_intents` enum membership, segment speaker/scenario reference legality, segment monotonic `start_ms < end_ms`, segment `expected_intent` enum membership, per-intent `coverageReport` counting, and reverse coverage validation against `expected_intent_coverage` (with `internal_chatter_suppression` excluded per brief).

### RED Evidence

Command:

```bash
node --test tests/utils/__tests__/sales-transcript-fixture-validator.test.mjs
```

After appending the 3 tests but before extending the validator:

- `rejects fixture missing required top-level keys`: PASS (the original Task 1 test).
- `detects duplicate speaker ids`: FAIL — `result.ok` was `true` because the skeleton did not collect duplicate-speaker errors.
- `detects scenario overlap`: FAIL — `result.ok` was `true` because the skeleton did not detect scenario overlap.
- `coverage report counts intent occurrences`: FAIL — `coverageReport.sales_pain_discovery` was `undefined` because the skeleton never populated the report.

Total: 4 tests, 1 pass, 3 fail.

### GREEN Evidence

Same command after extending the validator:

- `rejects fixture missing required top-level keys`: PASS.
- `detects duplicate speaker ids`: PASS — validator emits `duplicate speaker id: S1`.
- `detects scenario overlap`: PASS — validator emits `scenario overlap: s1 and s2` because s2.start_ms (400) < s1.end_ms (500).
- `coverage report counts intent occurrences`: PASS — `coverageReport.sales_pain_discovery === 1`.

Total: 4 tests, 4 pass, 0 fail.

### Concerns

- None. The extension is purely additive; the original `return` shape (`{ ok, errors, warnings, coverageReport }`) is preserved, so any existing callers (Task 1 commit `e905872d`) continue to work unchanged. The untracked `.tmp/` directory was not touched.

## Task 2 Fix Subagent

### Status

- DONE
- Branch: `ci/intel-mac-workflow`
- Commit: `d1438492 chore(validator): remove unused allSegmentStartEnds tracking`
- Scope limited strictly to `tests/utils/sales-transcript-fixture-validator.mjs`.

### What Was Removed

- `tests/utils/sales-transcript-fixture-validator.mjs:71` — `const allSegmentStartEnds = [];` (array declaration immediately above the segments loop).
- `tests/utils/sales-transcript-fixture-validator.mjs:79` — `allSegmentStartEnds.push([seg.start_ms, seg.end_ms]);` (push inside the segments loop).
- `tests/utils/sales-transcript-fixture-validator.mjs:84` — `allSegmentStartEnds.sort((a, b) => a[0] - b[0]);` (post-loop sort).

The array was collected and sorted but never read; removing it eliminates YAGNI dead code while preserving every existing error-detection branch and `coverageReport` accounting. No other lines in the validator were touched.

### Test Results

Command:

```bash
node --test tests/utils/__tests__/sales-transcript-fixture-validator.test.mjs
```

Output:

```text
✔ rejects fixture missing required top-level keys (1.131791ms)
✔ detects duplicate speaker ids (0.732458ms)
✔ detects scenario overlap (0.220458ms)
✔ coverage report counts intent occurrences (0.381792ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 34.693584
```

- 4 pass, 0 fail — matches the expected baseline.
