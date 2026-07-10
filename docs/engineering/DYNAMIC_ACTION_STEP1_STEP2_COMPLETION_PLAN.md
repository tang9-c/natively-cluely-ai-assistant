# Step 1 / Step 2 100% 完成方案：动作卡片契约与销售模式打穿

更新时间：2026-07-10

## Summary

目标是把路线图里的 Step 1 和 Step 2 从“链路和验收骨架已存在”推进到“可作为产品发布门禁”的 100% 状态。

当前代码图谱复核结论：

- Step 1 约 75% 完成：`DynamicActionProductContract`、`DynamicActionOutputType`、`DynamicActionRiskState`、`DynamicActionPayload.status`、`ActionArtifact` 已存在；缺口是 lifecycle 指标口径和 accepted output 真实验收。
- Step 2 约 65% 完成：销售 5 类关键瞬间、50 条 sales fixture、prompt 约束、会后 carryover 已有；缺口是完整 fixture matrix、accepted card 生成内容质量、RAG/PPTX/Windchill grounding。

100% 的定义不是“更多 trigger”。100% 的定义是：卡片出现、卡片内容、点卡生成、失败降级、会后落地和指标都能被测试证明。

## Step 1：动作卡片产品契约 100%

### 目标

把动作卡片从“UI + trace + 部分测试”收口为稳定产品契约：

```text
card shown
  -> accepted / auto_generated / dismissed / expired
  -> generated completed / generated_failed
  -> artifact carryover
  -> metrics aggregation
  -> answer quality validation
```

### 具体改动

1. 补齐 lifecycle 数据契约

先把 lifecycle 事件定义成唯一产品口径，避免 telemetry、diagnostics、store status、artifact status 各算各的：

```ts
type DynamicActionLifecycleEvent = {
  event:
    | 'shown'
    | 'accepted'
    | 'auto_generated'
    | 'dismissed'
    | 'expired'
    | 'generated_failed'
    | 'completed';
  actionId: string;
  actionType: string;
  modeId?: string;
  modeTemplateType: string;
  outputType: DynamicActionOutputType;
  riskState: DynamicActionRiskState;
  triggerSource?: 'manual' | 'auto_countdown';
  generationStatus?: 'completed' | 'generated_failed' | 'not_generated';
}
```

事实来源分工：

- `ContextQualityDiagnosticsCollector.recordDynamicActionLifecycleEvent()` 是运行时诊断事实来源，供设置/诊断、QA snapshot 和本地排障使用。
- `TelemetryService` 是 `DynamicActionMetricsAggregator` 的输入事实来源，供 `test:dynamic-actions:metrics` 和发布门禁使用。
- `DynamicAction.status` 只表示当前 action 在 store 里的生命周期状态，不单独作为指标来源。
- `ActionArtifact.generationStatus` 只表示 accepted 后是否产生可带到会后的内容，不承担生命周期指标。

事件记录位置必须固定：

- `shown`：`main.ts` 转发 `dynamic_action_emitted` 后记录。
- `accepted`：`dynamic-action:accept` 手动接受时记录，`triggerSource: manual`。
- `auto_generated`：`dynamic-action:accept` 自动倒计时时记录，`triggerSource: auto_countdown`，不要混入 `accepted`。
- `completed`：`dynamic-action:complete` 成功后记录。
- `generated_failed`：`dynamic-action:generation-failed` 成功后记录。
- `dismissed`：`dynamic-action:dismiss` 成功后记录。
- `expired`：`DynamicActionStore.expireStaleActions()` 返回 expired actions 后，由调用方逐条记录。不要只把状态留在 store 里。

- 在 `DynamicActionMetricsAggregator.ts` 中把 `CountSummary` 扩展为：
  - `shown`
  - `accepted`
  - `auto_generated`
  - `dismissed`
  - `expired`
  - `generated_failed`
  - `completed`
- `dynamic_action_accepted` 保持手动接受。
- 新增或规范 `dynamic_action_auto_generated`，不要把 auto countdown 混进 accepted。
- 新增或规范 `dynamic_action_completed`，`dynamic-action:complete` IPC 成功后同时记录 diagnostics 和 telemetry。
- `DynamicActionStore.expireStaleActions()` 产生 expired 时要能被上层记录 lifecycle，避免 expired 只存在于 store 状态。

2. 统一 diagnostics 与 QA metrics

- `ContextQualityDiagnosticsCollector.recordDynamicActionLifecycleEvent()` 继续作为运行时诊断入口。
- `DynamicActionMetricsAggregator` 的字段名必须和 diagnostics lifecycle event 一致，不能再靠 `status === generated_failed` 这类隐式映射补齐主事件。
- `run-dynamic-actions-metrics.mjs` 使用真实字段示例覆盖全部 lifecycle，不再只覆盖 shown/accepted。
- `TelemetryService.TelemetryEventName` 要显式包含 `dynamic_action_auto_generated`、`dynamic_action_completed`，如果继续兼容旧事件，也只能在 aggregator 中做向后兼容，不作为新口径。

3. 明确 accepted output validation contract

- 新增 `DynamicActionAcceptedOutputEvaluator` 或等价纯函数，输入：
  - action type
  - `productContract.outputType`
  - generated answer text
  - grounding metadata / citations / context trace
- 输出：
  - `passed`
  - `requiredPatternFailures`
  - `forbiddenPatternFailures`
  - `groundingFailures`
  - `missingFieldFailures`
- 不需要接真实 LLM；先用 deterministic generated answer fixtures 验证规则。
- evaluator 必须同时支持两层输入：
  - deterministic answer fixture：CI 默认路径，不依赖真实 LLM。
  - production usage metadata：从 `dynamic-action:accept -> WhatToAnswerLLM dynamic_action_instruction -> session.pushUsage(metadata.source === 'dynamic_action') -> dynamic-action:complete/generation-failed` 这条链读取 `answer`、`actionId`、`actionType`、`outputType`、`groundedSources`、`generationStatus`。
- 不能只检查 prompt 或 detector 静态文本。验收对象必须是“点卡后最终给用户的生成内容”。

4. 收口 artifact status

- `ActionArtifact.generationStatus` 保持 `completed | generated_failed | not_generated`。
- 如果需要区分手动接受和自动倒计时，新增 `acceptTriggerSource?: 'manual' | 'auto_countdown'` 或等价字段；不要把 `accepted`、`auto_generated` 塞进 `generationStatus`。
- 增加测试证明：
  - accepted 但没有 answer -> `not_generated`
  - accepted 后 answer 成功 -> `completed`
  - generation failed -> `generated_failed`
  - auto generated 成功也进入 artifact，且 `generationStatus === 'completed'`，`acceptTriggerSource === 'auto_countdown'`

### 测试

新增或更新：

- `DynamicActionMetricsAggregator.test.mjs`
  - 覆盖 `shown / accepted / auto_generated / dismissed / expired / generated_failed / completed`。
- `DynamicActionEngine.test.mjs`
  - 覆盖 stale expire 返回后被记录 lifecycle 的生产路径或可调用路径。
- `DynamicActionArtifactBuilder.test.mjs`
  - 覆盖 auto_generated 和 completed artifact，并验证 `generationStatus` 与 `acceptTriggerSource` 不混用。
- `DynamicActionAcceptedOutputEvaluator.test.mjs`
  - 覆盖每种 output type 的最低验收规则。
- `DynamicActionPromptInstructionWiring.test.mjs`
  - 覆盖 `dynamic-action:accept -> dynamic_action_instruction -> session usage metadata -> dynamic-action:complete/generation-failed` 的生产接线，不只检查 IPC 名称存在。

验证命令：

```bash
rtk npm run build:electron
rtk node --test electron/services/qa/__tests__/DynamicActionMetricsAggregator.test.mjs
rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs
rtk node --test electron/services/__tests__/DynamicActionArtifactBuilder.test.mjs
rtk node --test electron/services/__tests__/DynamicActionProductContract.test.mjs
```

### Step 1 完成标准

- lifecycle 指标口径覆盖 7 个状态：`shown / accepted / auto_generated / dismissed / expired / generated_failed / completed`。
- diagnostics summary 和 metrics aggregator 字段一致。
- accepted card 的生成内容有 action-type 级别验收函数和测试。
- artifact carryover 对手动接受、自动倒计时、completed、generated_failed、not_generated 都有测试，且不混淆 lifecycle status 和 generation status。
- `test:dynamic-actions:metrics` 输出里能看到 lifecycle、precision/recall、latency、trust source。

## Step 2：销售模式打穿 100%

### 目标

销售模式必须证明 5 类关键瞬间全链路可用：

```text
客户当前话术
  -> 是否应该弹卡
  -> 卡片上说什么
  -> 点卡后生成什么
  -> 会后记录/跟进如何落地
```

### 具体改动

1. 用完整 sales fixture matrix 替代 inline 代表样例

- `SalesDynamicActionProductFixtures.test.mjs` 改为读取 `tests/fixtures/dynamic-actions/product/sales.json`。
- 覆盖全部 50 条：
  - 中文、英文、中英混合
  - 价格异议、报价请求、案例/证明、技术/集成、购买/推进
  - 内部/客户身份错位
  - 旧话题污染
  - 价格误报负样本
- 断言：
  - `shouldEmit`
  - `actionType`
  - `productContract.outputType`
  - required / forbidden card copy

2. accepted output 质量验收

- 扩展 `SalesDynamicActionAnswerQuality.test.mjs`，不要只做静态 prompt 检查。
- 增加 deterministic accepted answer fixtures，作为 CI 默认路径：
  - `pricing_objection`：必须是可说出口回应，禁止价值点列表腔，禁止编 ROI/折扣/价格。
  - `pricing_request`：必须是 email draft，必须保留 placeholder，禁止编价格、客户名、合同条款。
  - `case_study_request`：必须引用 material / pptx / trusted context；没有资料时必须说明没有匹配 proof，禁止编客户案例。
  - `technical_requirements`：必须生成澄清 checklist，禁止承诺能力。
  - `buying_signal`：必须包含 owner/date/artifact；缺字段时必须追问，禁止脑补。
- 再增加 production wiring fixture：mock `WhatToAnswerLLM` 或等价生成入口，跑通 accepted action metadata，证明 evaluator 验证的是最终 usage answer，不是 detector/prompt 文案。

3. RAG / PPTX / Windchill grounding 验收

- 默认测试用 mock contract，不依赖真实 provider、真实 Windchill 或 PPTX 渲染：
  - material/PPTX grounding 用已有 material fixtures 和模拟检索结果。
  - business_context grounding 用模拟 `BusinessSystemContextService` 返回值。
  - unavailable/auth_failed/timeout 用稳定错误对象，不调用真实 MCP。
- 真实 RAG/PPTX/Windchill 只作为 opt-in smoke，不能进入默认 CI 门禁。
- 案例请求场景：
  - 有 case study material -> answer metadata `groundedSources` 包含 `material` 或 `pptx`，answer 提到来源事实。
  - 无 case study material -> answer 说明资料中没有匹配证明，不编造客户名或 ROI。
- 报价场景：
  - 有 pricing policy -> 只引用政策，不输出具体价格，除非 fixture 明确给出可信价格。
- PLM/Windchill 场景：
  - business system context available -> answer 可用只读事实。
  - unavailable / auth_failed / timeout -> answer 明确无法查询，不编 PLM 事实。

4. 会后记录闭环

- `PostCallWorkflow.test.mjs` 增加 5 类 sales artifact carryover：
  - price objection response
  - quote email
  - case/proof response
  - technical checklist
  - buying signal action item
- 每类都验证 `coachingInsights` 或 follow-up draft 有对应落地，不只是 JSON 包含 action type。

5. 指标门禁

- `test:dynamic-actions:product` 输出 sales 50 条 matrix score：
  - recall > 0.8
  - pricing false positive < 0.1
  - actionType/outputType match 100% for positive fixtures
- `test:dynamic-actions:metrics` 输出每个 sales action 的 lifecycle counts。
- 如果没有真实 LLM key，accepted output 用 deterministic harness；真实云端路径单独作为 opt-in smoke。

### 测试

新增或更新：

- `SalesDynamicActionProductFixtures.test.mjs`
  - 从 6 条 inline 改成读取 50 条 sales JSON。
- `SalesDynamicActionAnswerQuality.test.mjs`
  - 从静态 prompt contract 扩展为 deterministic accepted answer evaluator。
- `SalesDynamicActionGrounding.test.mjs`
  - 默认用 mock contract 覆盖 material / pptx / business_context 可用与不可用。
  - opt-in live smoke 才调用真实 RAG/PPTX/Windchill。
- `PostCallWorkflow.test.mjs`
  - 增加 5 类 sales artifact carryover。
- `SalesActionCardUx.contract.test.mjs`
  - 保留 UI contract，补 required/forbidden copy。

验证命令：

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/SalesDynamicActionProductFixtures.test.mjs
rtk node --test electron/services/__tests__/SalesDynamicActionAnswerQuality.test.mjs
rtk node --test electron/services/__tests__/PostCallWorkflow.test.mjs
rtk npm run test:dynamic-actions:product
rtk npm run test:dynamic-actions:metrics
```

### Step 2 完成标准

- 50 条 sales fixture 全部进入自动测试。
- 5 类 sales action 的 recall / false positive / outputType 均有机器可读结果。
- accepted output 对每类 action 有质量规则，不再只验证卡片出现。
- 案例、报价、PLM/Windchill 场景有 grounding 验收。
- 默认 grounding 验收不依赖真实外部服务；真实 provider 只作为 opt-in smoke。
- 会后 follow-up 能消费 accepted sales artifacts。
- 无真实 LLM key 时 deterministic harness 可跑；有 key 时 opt-in smoke 可验证真实 provider。

## 执行顺序

1. 先补 Step 1 lifecycle schema、diagnostics/telemetry 映射和 artifact 状态边界，因为 Step 2 的 sales 指标依赖它。
2. 再改 `SalesDynamicActionProductFixtures.test.mjs` 读取完整 50 条 matrix。
3. 再加 accepted output evaluator，先 deterministic，再接 production usage metadata，不接真实 LLM。
4. 再加 grounding mock contract 验收，复用 material/business system 现有路径；真实 RAG/PPTX/Windchill 放 opt-in smoke。
5. 最后把 product/metrics 命令输出收口成可读报告。

## 不做

- 不新增模式。
- 不扩展通用 MCP。
- 不做复杂卡片设计系统。
- 不要求 CI 默认调用真实 LLM / STT / Windchill；真实调用只放 opt-in smoke。
- 不把销售模式改成自动发送邮件或自动写 CRM。

## 风险

- 如果先接真实 LLM 评分，会让测试不稳定。先用 deterministic harness，再补 opt-in live smoke。
- 如果 lifecycle metric 继续分散在 telemetry、diagnostics、store status 中，产品指标会对不上。必须先统一字段。
- 如果把 `ActionArtifact.generationStatus` 当 lifecycle 状态扩展，会破坏 post-call carryover 的语义。必须用独立字段记录手动/自动接受来源。
- 如果 Sales fixture 只测 trigger，不测 accepted answer，销售模式会继续“看起来能用，但点了以后空泛”。
- 如果 grounding 默认测试依赖真实外部服务，CI 会变慢且不稳定。默认用 mock contract 证明不编造，真实服务只做 opt-in smoke。

## Completion Note

- Step 1 lifecycle metrics now use one seven-state event contract across diagnostics and telemetry: `shown / accepted / auto_generated / dismissed / expired / generated_failed / completed`.
- `ActionArtifact.generationStatus` remains limited to `completed | generated_failed | not_generated`; manual vs auto accept source is tracked separately through `acceptTriggerSource`.
- Step 2 sales fixtures now run the full 50-case `tests/fixtures/dynamic-actions/product/sales.json` matrix.
- Accepted output validation is deterministic by default and covers pricing objection, quote email, case proof, technical checklist, and buying signal outputs.
- Grounding validation is deterministic by default for material / pptx / business_context success and failure cases; live LLM/RAG/PPTX/Windchill remains opt-in smoke only.
- Post-call carryover now covers all five sales action types.
