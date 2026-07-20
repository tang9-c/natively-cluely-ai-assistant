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
