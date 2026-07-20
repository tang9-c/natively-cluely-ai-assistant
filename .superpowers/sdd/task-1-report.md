# Task 1 Report: Recruiting Intent Convergence and Exclusive Arbitration

## Status

Completed and committed as `f598df98` (`feat(recruiting): converge interview rubrics on evidence actions`).

## Implementation

- Added the five recruiting-only intents:
  - `recruiting_scorecard_gap`
  - `recruiting_bei_evidence_gap`
  - `recruiting_situational_evidence_gap`
  - `recruiting_risk_verification`
  - `recruiting_policy_question`
- Added their recruiting answer shapes, zero-shot labels, conservative keyword defaults, and keyword precedence. The situational labels require evidence missing from a candidate answer.
- Converged the four evidence intents on existing `candidate_experience_probe`, and the policy intent on existing `candidate_concern`. No new action types were added.
- Made all three recruiting live-assist actions high-risk, cloud-required, and non-fallback. Their policies now carry `exclusiveGroup: 'recruiting_live_assist'` with priorities 100, 80, and 60.
- Added generic `selectPassedGateDecisions()`. It preserves ungrouped passed decisions and selects one grouped decision by confidence, selection priority, then action type.
- Applied arbitration between semantic gating and signal tracking. Losing siblings emit a reject trace with `exclusive_group_arbitration_lost` and never reach the signal tracker or action store.
- Tightened recruiter-facing prompts, labels, and product contracts: one neutral evidence follow-up, trusted-policy/confirmation boundary, and no claim that an interested candidate is a strong fit.
- `electron/llm/IntentClassifier.ts` was added to the write set after explicit authorization, solely to synchronize its duplicate intent union and required answer-shape record entries.

## RED Evidence

Command:

```bash
rtk npm run build:electron:tsc
rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/ModeEventClassifier.test.mjs
```

Key output before implementation:

- Electron TypeScript build passed.
- Focused tests: 140 total, 138 passed, 2 failed.
- `recruiting evidence rubric intents converge on candidate_experience_probe` returned `[]` instead of `['candidate_experience_probe']`.
- `selectPassedGateDecisions is not a function`.

## GREEN Evidence

Command:

```bash
rtk npm run build:electron:tsc
rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/ModeActionPolicy.test.mjs electron/services/__tests__/ModeEventClassifier.test.mjs
```

Final output:

- Electron TypeScript build passed.
- 146 tests passed, 0 failed, 16 suites.
- Coverage includes rubric convergence, one-card arbitration, confidence/priority/action-type ties, and rejected-sibling trace/store exclusion.

## Files

- `electron/llm/IntentClassifier.ts`
- `electron/llm/IntentClassifierShared.ts`
- `electron/llm/IntentKeywordDefaults.ts`
- `electron/services/dynamic-actions/ModeActionPolicy.ts`
- `electron/services/dynamic-actions/ModeEventClassifier.ts`
- `electron/services/dynamic-actions/DynamicActionEngine.ts`
- `electron/services/dynamic-actions/DynamicActionDetector.ts`
- `electron/services/dynamic-actions/DynamicActionProductContract.ts`
- `electron/services/__tests__/DynamicActionEngine.test.mjs`
- `electron/services/__tests__/ModeActionPolicy.test.mjs`
- `electron/services/__tests__/ModeEventClassifier.test.mjs`

## Self-Review

- `git diff --check` passed before staging.
- The staged commit contains only the approved 11 source and test files.
- `.tmp/` was observed as pre-existing and was not read, changed, staged, or committed.
- The code-review graph identified `assessSignals()` as the highest-risk change; an end-to-end test verifies that an arbitration loser is traced as rejected and is absent from the action store.

## Concerns

- No remaining implementation concerns for Task 1.
- By design, recruiting live-assist cards defer when cloud confirmation is unavailable or transcript scope is denied; this is the required cloud-only boundary.
- The report is committed separately after `f598df98`, because the brief's exact functional `git add` list excluded it.

## Reviewer Follow-up: Partial Invalid JSON and Interest Trigger

### Implementation

- A `cloud_invalid_json` response now prevents recruiting candidates that are cloud-required and disallow local fallback from adopting any otherwise-valid partial cloud result. They remain unresolved and therefore defer with `cloud_invalid_json`.
- The restriction is explicitly scoped to `modeTemplateType === 'recruiting'`; Sales and FDE retain their existing partial-result behavior.
- `strong_fit_signal` now requires a candidate's explicit interest in the role or team. Interviewer statements that a candidate is a great fit or a perfect match no longer trigger it.

### RED Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/ModeEventClassifier.test.mjs electron/services/__tests__/ModeActionPolicy.test.mjs
```

Key output before the reviewer fixes:

- Electron TypeScript build passed.
- Focused tests: 149 total, 147 passed, 2 failed.
- A valid `candidate_concern` pass plus an invalid cloud entry produced `['pass', 'defer']`, rather than deferring both required recruiting candidates.
- `这个候选人很匹配这个岗位，经验也很适合。` incorrectly triggered `strong_fit_signal`.

### GREEN Evidence

Command:

```bash
rtk npm run build:electron:tsc && rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/ModeEventClassifier.test.mjs electron/services/__tests__/ModeActionPolicy.test.mjs
```

Final output:

- Electron TypeScript build passed.
- 149 tests passed, 0 failed, 16 suites.
- A partial-invalid recruiting cloud response defers every required/no-fallback candidate with `cloud_invalid_json`.
- A partial-invalid Sales response continues to accept its valid cloud decision, proving the recruiting guard did not change Sales behavior.
- Interviewer match evaluation does not trigger `strong_fit_signal`; explicit candidate role interest can pass through the cloud gate.

### Files

- `electron/services/dynamic-actions/ModeEventClassifier.ts`
- `electron/services/dynamic-actions/DynamicActionDetector.ts`
- `electron/services/__tests__/ModeEventClassifier.test.mjs`
- `electron/services/__tests__/DynamicActionEngine.test.mjs`

### Commit

- `84a9802f` `fix(recruiting): defer partial invalid cloud gates`

### Self-Review and Concerns

- `git diff --check` passed before staging; the code commit contains only the four Task 1 source/test files listed above.
- Code-review graph review identified `ModeEventClassifier.assess()` as the affected path; focused tests exercise the new defer path and the preserved Sales path.
- No remaining implementation concerns. `.tmp/` remained untracked and untouched.
