# P0-1 动态动作意图识别语义门控开发方案

## 摘要

目标是把动态动作从“关键词命中后触发”改为“关键词召回候选，动作级语义门控确认，再决定是否生成动态动作”。

核心原则：

- Regex 只负责召回候选词和候选动作，不直接生成高风险动态动作。
- 本地意图识别模型可用时优先使用，但不能作为唯一可靠路径，因为它可能未安装、未开启、加载失败或超时。
- 云端 LLM 是高风险动作的正式语义兜底：本地不可用、低置信、多候选冲突、英文/混合语言、否定转折或自动展示风险场景必须进入云端结构化确认。
- 默认上下文不使用 12 轮，改为当前 final transcript 加最近 4-6 轮；复杂场景最多扩展到 8 轮或 120 秒。
- 高误报动作必须双确认；高价值明确动作可走白名单快速通道，但必须记录 trace。

## 目标流程

```text
final transcript
-> regex 召回候选动作
-> 本地意图识别模型可用时先判断真实语义
-> 本地不可用、低置信、冲突、英文/混合语言或高风险时云端 LLM 结构化确认
-> semantic gate 输出 pass / reject / defer / fast_path
-> SignalStateTracker 做重复证据和自动展示判断
-> 生成 DynamicAction，并写入 semantic gate trace
```

## 关键改动

### 1. 新增动态动作语义门控层

建议新增 `electron/services/dynamic-actions/ModeEventClassifier.ts`。

输入至少包含：

- 当前 final transcript。
- 最近 4-6 轮上下文；低置信、多候选冲突、否定/转折或云端仲裁时最多扩展到 8 轮或 120 秒。
- 当前 mode/template。
- speaker/channel。
- regex candidates。
- 现有 `intentResult`。
- 当前 active dynamic actions。

输出结构：

- `decision: pass | reject | defer | fast_path`
- `actionType`
- `semanticIntent`
- `confidence`
- `reasons`
- `regexCandidates`
- `rejectedCandidates`
- `usedLocalIntentModel`
- `usedCloudArbitration`
- `semanticProvider: local_intent | cloud_llm | rule_fast_path | unavailable`
- `degradedReason`
- `upgradedByRepeatedEvidence`

### 2. 动作级语义分类器，而不是直接复用宽泛 intent

- 新增动作级 semantic gate classifier，输出动作类型级别的判断，例如 `pricing_objection`、`case_study_request`、`technical_requirements`，不能只输出 `handle_objection`、`seize_signal`、`discovery_probe` 这类宽泛 intent。
- 现有 `classifyIntent()` / local intent enhancement 可作为输入信号，但不能作为唯一门控结果。
- 当前 `classifyIntent()` 的云端 fallback 主要面向中文，且候选 intent 粒度不够细；P0-1 必须补上英文和混合语言的动作级云端确认路径。
- 动态动作不能只把命中的词交给模型，而要提交当前句、最近上下文、mode、speaker、候选动作列表。
- 云端 LLM 输出必须是严格 JSON，只能从传入候选动作集合中选择，不能自由生成新动作类型。

### 3. 本地模型与云端 LLM 的优先级

本地模型可用时优先跑本地模型，但以下情况必须进入云端 LLM 结构化确认：

- 本地模型未安装、未开启、加载失败或超时。
- 本地模型置信度低。
- 同一句同时召回多个高误报候选，例如价格、案例、技术需求。
- 当前语义包含否定、转折、排除，例如“价格先放一边”。
- 当前输入是英文或中英混合，且现有 `classifyIntent()` 无法提供动作级确认。
- 高价值动作准备自动展示或自动执行。

云端输入必须使用压缩后的最近 4-8 轮上下文，不能默认提交 12 轮完整对话。云端调用必须有短超时，例如 2.5 秒；失败不能阻塞转写主链路。

如果 provider data scope 禁止发送 transcript，或所有云端 provider 不可用，高风险候选只能 `defer` 或 `reject`，并写入明确 trace，例如 `cloud_semantic_gate_unavailable` 或 `provider_scope_denied`，不能假装完成语义理解。

### 4. DynamicActionEngine 接入

修改 `DynamicActionEngine.assessSignals()`：

- `detectTriggers()` 输出只作为 candidate input。
- 只有 `pass`、`fast_path` 或符合重复证据升级条件的 `defer` 结果才进入 `SignalStateTracker`。
- `reject` 不生成 action。
- `defer` 可以等待重复证据或生成低优先级卡片，但不能自动执行。
- `buildAction()` 把 semantic gate 元数据写入 `DynamicAction`。
- 修正 sales intent 映射，避免 `discovery_probe` 默认映射到 `pricing_request`；为案例/证明请求、技术需求/集成需求提供明确映射。
- 约束或迁移 `detectActions()`：高风险动作不能继续从 `detectActions()` regex 直出。若保留该 API，必须标记为 legacy/test-only，或让它内部复用 semantic gate 的安全路径。

### 5. IntelligenceEngine 传入紧凑上下文

修改 `IntelligenceEngine.detectConfirmAndEmitDynamicActions()`：

- 复用现有 `this.session.getContext(180)` 和 `transcriptTurns`。
- 传给 `assessSignals()` 的默认窗口为当前句加最近 4-6 轮。
- 只有低置信、多候选冲突、否定/转折或云端仲裁时才扩展到最多 8 轮或 120 秒。
- 第一版 `channel` 等同现有 `segment.speaker`，不新增复杂 diarization 抽象。

### 6. Trace 和类型

扩展 `DynamicAction` 与 renderer mirror type：

- 增加 `semanticGate` 元数据。
- 每个生成的动态动作必须能解释：
  - 哪些 regex candidate 被召回。
  - 本地模型判断出的真实意图是什么。
  - 是否调用云端仲裁。
  - 为什么通过或为什么没有被拦截。
  - 是否因为重复证据升级。

被 reject 的候选第一版不生成卡片，但测试中必须能验证 reject reason。

## 高风险双确认范围

以下类型必须经过 regex candidate 加 semantic confirmation：

- 价格异议。
- 报价请求。
- 案例/证明请求。
- 技术需求/集成需求。
- 下一步/购买信号。

中性提及必须拦截：

- `price list`
- `pricing page`
- `成本数据`
- `价格先放一边`

## 白名单快速通道

以下明确动作可保留强规则快速通过，但仍必须记录 trace：

- 发合同。
- 安排时间。
- 屏幕上有技术题。
- 明确 action item。

快速通道不能扩大到价格、案例、技术需求、购买信号。

## Phase 0 可信度闭环补齐

增加固定质量回归命令，覆盖动态动作语义门控、mode intent、answer trace contract。

增加开发诊断输出：

- 答案延迟。
- 引用命中率。
- 用户接受率。
- 重新生成率。
- RAG 命中率。
- 无上下文回答率。
- 降级原因分布。

第一版只做确定性的开发诊断输出，不先做完整产品化仪表盘。

## 测试方案

新增语义门控单元测试：

- “价格先放一边，我们想看客户案例和 API 集成要求”
  - 不触发价格动作。
  - 触发案例请求。
  - 触发技术需求。
- “price list / pricing page / 成本数据”
  - 不触发价格异议。
- “这个技术方案怎么对接 SSO 和生产环境”
  - 触发技术需求。
- “客户要一个类似案例证明 ROI”
  - 触发案例/证明请求。
- “这个价格太高了 / too expensive”
  - 仍触发价格异议。

增加多轮上下文测试：

- 默认只使用最近 4-6 轮。
- 多候选冲突时扩展到最多 8 轮。
- 旧价格讨论不能污染当前技术需求判断。

增加降级测试：

- 本地意图模型未安装、未开启、加载失败、超时时，不假装完成语义理解。
- 本地不可用时，英文和混合语言高风险候选能走云端动作级语义确认。
- provider data scope 禁止 transcript 时，高风险候选只 `defer` 或 `reject`，不自动执行。
- 云端 LLM 输出非法 JSON、动作类型不在候选集合、超时或 provider 失败时，候选不自动出卡，并写入降级原因。
- `detectActions()` 不能绕过 semantic gate 直接生成高风险动作。

固定验证命令：

```bash
rtk npm run build:electron
rtk npm run typecheck:electron
rtk ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/ModeEventClassifier.test.mjs electron/services/__tests__/DynamicActionEngine.test.mjs electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs electron/llm/__tests__/ModeAwareIntent.test.mjs
rtk npm run test:quality:smoke
```

## 假设

- 第一版以动作级语义门控为主：本地模型可用时优先，本地不可用或不可靠时云端 LLM 是高风险动作的正式兜底。
- 默认上下文窗口为当前句加最近 4-6 轮。
- 只有低置信、多候选冲突、转折/否定、自动执行风险场景才扩展到最多 8 轮或 120 秒。
- 云端 LLM 语义确认必须遵守 provider data scope；若用户关闭或 scope 禁止，则高风险动作降级为 `defer` 或 `reject`。
- 动态动作宁可少触发，也不能因为关键词误触发。
