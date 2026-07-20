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
