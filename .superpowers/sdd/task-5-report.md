# Task 5 Report: Recruiting Product, Continuation, and Safety Fixture Matrices

## STATUS
DONE

## 实现内容

- 扩充 Recruiting product fixture matrix，并以真实 `DynamicActionFixtureRunner` 驱动 action、独立 deterministic cloud semantic classifier seam、production exclusive arbitration、accepted-output evaluator 路径。
- 增加 Recruiting continuation fixture matrix，并以真实 `DynamicActionContinuationFixtureRunner` 驱动 parent action、continuation policy、planner、derived action、runtime evaluator、safe fallback 与 post-call carryover。
- 以 continuation policy 决定 derived action type；以单个 mode-to-context builder record 构造派生上下文；以 `DynamicActionRuntimeValidationPolicy` 选择 safe fallback；并从 engine store 读取实际 child actions 计算 count/duplicate。Sales/FDE fixture 行为保持回归通过。
- 增加 Recruiting safety matrix，直接使用 Task 2 `evaluateDynamicActionAcceptedOutput`，覆盖可见方法分类、施压语言、最终录用/淘汰/排名、受保护属性依据和无依据 recruiting policy；包含候选人主动提及家庭情境但回答不将其作为招聘依据的合法反例。

## Fixture 统计与实际测量

### Product Matrix

- 总数：46
- Positive：36
  - `candidate_concern`：14（包含 6 个 collision fixture）
  - `candidate_experience_probe`：18，覆盖 `personal_action`、`result`、`ownership`、`tradeoff_or_verification`
  - `strong_fit_signal`：4
- Negative：10
- 语言：中文、英文、混合语言均覆盖；说话人覆盖 candidate、interviewer、internal。
- Recall：`36/36 = 1.00`，门槛 `>= 0.80`；由 `semanticGateMode: 'real'` + 独立 `deterministicRecruitingClassifier` seam 测得。
- False-positive rate：`0/10 = 0.00`，门槛 `< 0.10`；同一独立 seam 测得。
- Collision：6 个 fixture 均在 `real` gate 下命中预期 action；生产 `assessSignals` exclusive arbitration 每个 collision 实际输出恰好 1 张卡。
- fixture schema、answer quality、grounding、missing-field failures：均为 `0`。

### Continuation Matrix

- 总数：16；Positive：8；Negative：8。
- Positive：全部派生且实际 child count 均为 `1` 个 `candidate_evidence_summary`，共 `8` 个；重复 derived action `0`；generated visible answer `8`；post-call carryover `8`。
- Negative：全部不派生卡片，visible answer 均为 `none`，共 `8` 个。
- Negative reason 全覆盖：`wrong_speaker`、`interim_turn`、`unrelated_topic`、`provider_scope_denial`、`planner_timeout`、`invalid_json`、`final_hiring_judgment`、`unsupported_invented_evidence`。
- Runner result：`16/16` 通过；unsafe visible answers：`0`。`recruiting-continuation-zh-action-001` 覆盖 collecting 后的重复 eligible turn 与后续 eligible final turn，parent 仍只产生 1 个 store child。

### Safety Matrix

- Unsafe input：26 条（18 条 candidate evidence summary，8 条 recruiting policy answer），全部被 Task 2 evaluator 拒绝。
- Unsafe escapes：`0/26`。
- 合法反例：1 条，通过；候选人主动提及家庭情境时，回答只记录岗位相关已观察证据与待验证项，未将家庭情境作为招聘/录用依据。

## RED：先写测试并确认失败

命令：

```bash
rtk node --test \
  electron/services/__tests__/RecruitingDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/RecruitingDynamicActionAnswerQuality.test.mjs \
  electron/services/__tests__/DynamicActionContinuationEndToEnd.test.mjs
```

结果：7 个子测试中 4 通过、3 失败。

- `recruiting continuation fixtures emit neutral evidence summaries only after eligible evidence`：失败，`tests/fixtures/dynamic-actions/continuation/recruiting.json` 尚不存在（`ENOENT`）。
- `recruiting product fixtures cover the release matrix`：失败，既有 Recruiting product fixture 只有 5 条，未达到 `>= 40`。
- `recruiting product fixtures exercise the deterministic action and accepted-output path`：失败，既有矩阵的 recall 为 `0.75`，低于 `0.80` 门槛。

失败原因符合预期：Task 5 的 Recruiting fixture matrix、continuation matrix 和 policy-record runner 接线均尚未实现。Safety evaluator 测试在 RED 阶段已通过，证明该行为来自 Task 2 既有实现；本任务为其补齐具体 release matrix。

## 初始 GREEN：Task 5 实现后验证

```bash
rtk npm run build:electron:tsc
```

结果：通过，`tsc -p electron/tsconfig.json` exit 0。

```bash
rtk node --test \
  electron/services/__tests__/RecruitingDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/RecruitingDynamicActionAnswerQuality.test.mjs \
  electron/services/__tests__/DynamicActionContinuationEndToEnd.test.mjs
```

结果：`7/7` 子测试通过，`0` 失败。

- Sales continuation zh：通过。
- FDE continuation release gates：通过。
- Recruiting continuation matrix：通过。
- Recruiting unsafe answer matrix：通过。
- Recruiting legitimate counterexample：通过。
- Recruiting product release matrix：通过。
- Recruiting deterministic action / accepted-output / collision path：通过。

## Reviewer P1 修复：独立 semantic seam 与实际 child count

### RED

```bash
rtk node --test \
  electron/services/__tests__/RecruitingDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/RecruitingDynamicActionAnswerQuality.test.mjs \
  electron/services/__tests__/DynamicActionContinuationEndToEnd.test.mjs
```

结果：8 个子测试中 6 通过、2 失败。

- Recruiting product release gate：失败，旧 runner 未透传外部 classifier，`real` gate 下 recall 为 `0`，符合独立 seam 尚未接通的预期。
- Recruiting continuation matrix：失败，旧 result 未提供 `derivedActionCount`，无法证明实际 child 数量。

### GREEN

```bash
rtk npm run build:electron:tsc
```

结果：通过，`tsc -p electron/tsconfig.json` exit 0。

```bash
rtk node --test \
  electron/services/__tests__/RecruitingDynamicActionProductFixtures.test.mjs \
  electron/services/__tests__/RecruitingDynamicActionAnswerQuality.test.mjs \
  electron/services/__tests__/DynamicActionContinuationEndToEnd.test.mjs
```

结果：`8/8` 子测试通过，`0` 失败。包含 Sales continuation、FDE continuation、Recruiting product real-gate seam、classifier expected-conflict guard、Recruiting continuation actual-child-count 和 safety matrix。

## 实际改动文件

仅以下 6 个文件，均属于 Task 5 commit：

- `electron/services/__tests__/DynamicActionContinuationEndToEnd.test.mjs`
- `electron/services/__tests__/RecruitingDynamicActionAnswerQuality.test.mjs`
- `electron/services/__tests__/RecruitingDynamicActionProductFixtures.test.mjs`
- `electron/services/qa/DynamicActionContinuationFixtureRunner.ts`
- `tests/fixtures/dynamic-actions/continuation/recruiting.json`
- `tests/fixtures/dynamic-actions/product/recruiting.json`

Reviewer P1 额外改动：

- `electron/services/qa/DynamicActionFixtureRunner.ts`
- `electron/services/qa/DynamicActionContinuationFixtureRunner.ts`
- `electron/services/__tests__/RecruitingDynamicActionProductFixtures.test.mjs`
- `electron/services/__tests__/DynamicActionContinuationEndToEnd.test.mjs`
- `tests/fixtures/dynamic-actions/continuation/recruiting.json`

## 自审

- `git diff --check` 在 Task 5 commit 前通过。
- 图谱 change review 未发现超出 fixture runner 与测试范围的受影响生产 flow。
- Recruiting product release gate 使用 `semanticGateMode: 'real'`，并将测试顶层定义的 `deterministicRecruitingClassifier` 原样传入 runner。该 classifier 只读取 `CloudSemanticGateInput` 的 transcript、speaker、candidates 和 policy summary；它不闭包捕获 fixture、expected、tags 或 id。
- classifier expected-conflict guard 以相同 classifier input 附加冲突的 `expected.actionType`，确认决策不变；因此 expected 不参与 Recruiting classifier 决策。
- fixture oracle 仍可供既有 Sales/FDE deterministic CI 使用，但 Recruiting release gate 不使用它，也不将其声明为独立质量度量。
- continuation result 通过 engine store 按 session、mode、mode template、parentActionId 与 derived type 读取全部实际 children，`derivedActionCount` 和 `duplicateDerivedActions` 不再由 enqueue 返回值或硬编码推断。
- Sales/FDE continuation E2E 与 Recruiting 目标测试在最终命令中共同通过。
- 未修改未跟踪 `.tmp/`。

## Concerns

- 无阻塞 concern。
- Recruiting 指标来自本地 deterministic classifier seam，不代表或替代生产云 classifier 的实时质量评估；它只用于固定 release matrix 的可重复验证。

## Task Commit

- `ce7f0161 test(recruiting): add evidence and safety release matrices`
- `de54b7f6 test(recruiting): isolate fixture semantic gate`
