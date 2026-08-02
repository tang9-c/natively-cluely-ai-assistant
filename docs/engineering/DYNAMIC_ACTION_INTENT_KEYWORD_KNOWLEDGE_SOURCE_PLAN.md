# 全模式智能卡片意图触发、知识源与业务系统查询根因修复方案

## 文档状态

- 状态：已结合当前代码链路完成技术审查，可直接进入开发。
- 范围：动态卡片候选生成、模式意图词、语义门控、actionType 映射、上下文需求、知识源 RAG、业务系统 MCP/Adapter、执行降级与相关设置文案。
- 最高优先目标：消除用户配置意图词后的候选漏生成，并阻止卡片错误调用知识源或错误业务系统。
- 本文只定义实施方案，不代表功能已经实现或测试已经通过。

## 1. 审查结论

现有问题不是单个 `IQC` 正则缺失，而是四段契约没有闭合：

```text
活跃模式意图词
  → IntentResult
  → DynamicAction 候选
  → semantic gate
  → actionType 对应的 contextNeedDecision
  → 知识源或业务系统执行
```

经当前代码链路复核，确认存在以下根因：

| 根因 | 当前代码证据 | 用户影响 |
| :--- | :--- | :--- |
| 活跃模式词表命中后仍受固定置信度和来源白名单限制 | `IntentKeywordDefaults.matchIntentKeywords()` 只返回 intent；`IntentClassifier.confidenceForKeywordIntent()` 对部分 intent 只给 `0.75`；`DynamicActionEngine.canSynthesizeIntentCandidate()` 要求 `>= 0.85` 且只接受 `cloud/pattern/context` | `sales_capability_fit`、`sales_contextual_proof_discovery`、`recruiting_policy_question`、`fde_agent_feasibility` 等即使命中用户配置词，也可能没有候选 |
| 当前分类结果无法记录命中的具体词 | `IntentResultSource` 没有 `mode_keyword`，`IntentResult` 没有 `matchedKeyword` | 无法区分“系统正则命中”和“活跃模式词表命中”，也无法诊断用户配置是否真正参与候选生成 |
| intent 映射仍是单一静态结果 | `DynamicActionEngine.mapIntentToActionType()` 将 `sales_capability_fit` 和 `sales_contextual_proof_discovery` 固定映射为 `discovery_question` | 明确能力问句或明确案例请求仍可能只生成追问卡 |
| 上下文需求仍受证据文本正则影响 | `ContextNeedDecision.buildDynamicActionContextNeedDecision()` 使用 `BUSINESS_SIGNAL_PATTERN` 和 `MATERIAL_SIGNAL_PATTERN` 扫描 action label、模式和转录证据 | 普通 FDE 集成讨论只要出现 PLM/BOM 等词，就可能错误发起业务系统查询；普通“资料”表述也可能错误触发 RAG |
| 显式业务查询没有独立 actionType | `DynamicActionEngine`、`ModeActionPolicy`、`DynamicActionProductContract` 中不存在 `business_system_query` 的完整产品契约 | “查一下 PLM 里的 BOM 状态”可能被映射成 FDE 追问或普通回答，无法稳定执行 MCP |
| 动态卡片执行丢失业务查询主文本 | `DynamicActionBar` 将 `action.promptInstruction` 作为 options 中的 prompt instruction；`NativelyInterface.handleWhatToSay()` 调用 IPC 时 positional `question` 为 `undefined`；`prepareBusinessContext()` 只用 `request.question` 作为查询，把 `modeEvent.latestTurn` 仅作为 recentContext | 不是 promptInstruction 覆盖了 question，而是业务查询服务根本没有收到 `latestTurn` 作为 question，最终返回 `skipped` |
| 泛化业务源存在误路由 | `BusinessSystemSourceKind` 只有 `plm/qms/business_system`；`enabledSourcesForHint(..., 'business_system')` 会返回所有启用源并优先默认源 | ERP/MES/CRM 查询可能被错误发送给默认 PLM 或 QMS 源 |
| MCP 成功结果契约不完整 | `normalizeBusinessMcpToolResult()` 只保留 summary/items，不解析 evidence；`hasBusinessSystemContent()` 又只认可 summary/evidence | MCP 返回结构化 evidence 或仅返回 items 时可能被误判为无有效内容 |
| 业务状态成功结果仍会经过 LLM | `generate-what-to-say` 仅对业务系统 fixed reply 短路；成功 context 仍进入 `runWhatShouldISay()` | 即使 MCP 返回真实状态，LLM 仍可能添加结果中不存在的字段或推断 |

### 1.1 必须纠正的原方案假设

1. **当前不是三套并行候选来源。** 数据库会为模式播种默认词，用户编辑后仍保存为同一组活跃模式词表。运行时 `ModesManager.getActiveMode()` 只返回当前词表。因此本文统一称为“活跃模式意图词”，其内容可能是播种默认值，也可能已被用户编辑；本轮不伪造“默认词/用户词”的历史来源。
2. **不能新增第二套单值 contextNeed 枚举。** 项目已有 `ContextNeedDecision`，包含 `material/business/screen` 三个维度，取值为 `required/use_if_ready/not_needed/unknown`。本方案只完善现有契约。
3. **`use_if_ready` 不等于主动检索。** `WhatToSayContextPreparation.shouldUseReadyContext()` 会跳过慢检索，仅使用已有缓存；需要保证本次主动查询时必须使用 `required`。
4. **`retrievalQuery` 不是业务系统原始查询。** 它由 `buildRetrievalQuery()` 合成，适合资料检索，不应替代用户原话发送给 MCP。

## 2. 成功标准

开发完成后必须满足：

1. 活跃模式意图词命中后，一定形成可进入 semantic gate 的 intent 候选，不再被 detector 正则或 `0.85` 合成门槛提前丢弃。
2. 命中词只负责生成候选，不负责直接展示；所有候选仍经过 semantic gate、互斥仲裁、冷却和去重。
3. 不同模式复用统一候选流程，但通过明确的模式分流生成不同 actionType。
4. 知识源和业务系统是两条独立执行链；普通资料问答不得调用业务系统，普通业务讨论不得因为出现 PLM/BOM 就调用 MCP。
5. 只有 `business_system_query` 可以主动调用业务系统；它必须使用原始发言，不使用 promptInstruction 或合成 retrievalQuery 代替。
6. 业务系统失败和成功结果都不能由 LLM 补写对象状态：失败返回固定中文提示，成功返回由结构化结果确定性格式化的中文答案。
7. 每个一等模式可生成的 actionType 都必须得到非 `unknown` 的 `ContextNeedDecision`。

## 3. 当前真实执行链路

### 3.1 意图词保存和读取

```text
ModesSettingsBase.handleSave()
  → preload.modesUpdate()
  → ipcHandlers modes-update
  → ModesManager.updateMode()
  → DatabaseManager.upsertIntentKeywords()

IntelligenceEngine.buildIntentClassificationOptions()
  → ModesManager.getActiveMode()
  → keywordRowsToMap(activeMode.intentKeywords)
  → classifyIntent(..., customIntentKeywords)
```

### 3.2 动态卡片候选与展示

```text
IntelligenceEngine.detectConfirmAndEmitDynamicActions()
  → DynamicActionEngine.detectSignalCandidates()
  → IntelligenceEngine.runDynamicActionGate()
  → classifyIntent()
  → DynamicActionEngine.assessSignals()
      → detector 候选
      → synthesizeTrigger(intentResult)
      → canSynthesizeIntentCandidate()
      → ModeEventClassifier.assess()
      → selectPassedGateDecisions()
      → SignalStateTracker.assess()
      → DynamicActionStore.deduplicate()
  → dynamic_action_emitted
  → DynamicActionBar
```

Sales、FDE、Recruiting、Team-meet 当前被 `isDetectorOnlyDynamicActionMode()` 标记为 detector-only，但仍会执行本地活跃模式词表分类；这几个模式只是关闭了云端 intent classifier，不是跳过 semantic gate。

### 3.3 卡片接受后的上下文链路

```text
DynamicActionBar.toModeEvent(action)
  → NativelyInterface.handleWhatToSay(action.promptInstruction, modeEvent)
  → preload.generateWhatToSay(
        question = undefined,
        options.promptInstruction = action.promptInstruction,
        options.modeEvent = modeEvent
     )
  → ipcHandlers generate-what-to-say
  → sanitizeModeEvent()
  → prepareWhatToSayContext()
      → prepareMaterialContext()
      → prepareBusinessContext()
      → prepareScreenContext()
  → runWhatShouldISay()
```

因此业务查询断点必须在 `prepareBusinessContext()` 修复：动态卡片的原始发言位于 `modeEvent.latestTurn`，而不是 positional question。

## 4. 目标架构

```text
final transcript segment
  ├─ 显式业务查询检测
  ├─ 活跃模式意图词匹配
  ├─ 现有 detector 规则
  └─ 现有分类 fallback
        ↓
  统一 IntentCandidate[]
        ↓
  模式分流 resolveActionTypeForIntent()
        ↓
  按 actionType 合并、去重、优先级仲裁
        ↓
  semantic gate
        ↓
  SignalStateTracker / cooldown
        ↓
  DynamicAction + ContextNeedDecision
        ↓ 用户接受
  ┌──────────────────┬────────────────────┬────────────────────┐
  │ transcript only  │ material required  │ business required  │
  │ 不调用外部上下文 │ Knowledge RAG      │ MCP/Adapter         │
  └──────────────────┴────────────────────┴────────────────────┘
```

## 5. 候选生成契约

### 5.1 活跃模式词表匹配结果

在 `electron/llm/IntentKeywordDefaults.ts` 引入明确返回值：

```ts
export interface IntentKeywordMatch {
  intent: ConversationIntent;
  matchedKeyword: string;
}

export function matchIntentKeywords(...): IntentKeywordMatch | null
```

匹配规则保持现有 `INTENT_MATCH_ORDER_BY_TEMPLATE`，本轮只返回第一个确定匹配，不扩展为多标签分类。

在 `electron/llm/IntentClassifier.ts` 扩展：

```ts
export type IntentResultSource =
  | 'pattern'
  | 'mode_keyword'
  | 'cloud'
  | 'local_slm'
  | 'context';

export interface IntentResult extends RawIntentResult {
  source: IntentResultSource;
  matchedKeyword?: string;
}
```

约束：

- `mode_keyword` 表示命中当前活跃模式词表，不声称该词一定由用户新建。
- 只在 `source === 'mode_keyword'` 时填写 `matchedKeyword`。
- 当存在活跃模式词表时，精确词表匹配必须先于 `cloudFirst`，避免 General/Interview/Lecture 模式被云分类提前覆盖。
- 词表未命中后，继续现有 pattern/cloud/local/context fallback。
- `confirmationSourceFor()` 将 `mode_keyword` 归为 `local_intent`。

### 5.2 允许词表候选进入 semantic gate

修改 `DynamicActionEngine.canSynthesizeIntentCandidate()`：

- `mode_keyword` 不受现有 `>= 0.85` 合成门槛阻断。
- 仍要求 intent 能映射到明确 actionType。
- 仍拒绝同 actionType 的重复 detector 候选。
- 仍不把本地零样本 SLM 结果直接作为权威候选。
- 词表候选进入 semantic gate 时保留分类置信度，不通过全局抬高或降低 `CARD_MIN` 改变其它候选行为。
- 对来源包含 `mode_keyword` 或 `business_query` 的显式候选，semantic gate 返回 `pass` 或 `fast_path` 后，由 gate 结果直接确认普通卡片资格，不再被 `SignalStateTracker.CARD_MIN` 二次丢弃。
- 显式候选仍不得仅凭一次 gate pass 获得 auto-surface 资格；自动执行继续要求现有 `AUTO_MIN`、重复证据和产品策略全部满足。

### 5.3 候选来源和去重

内部候选增加来源：

```ts
type DynamicActionCandidateSource =
  | 'business_query'
  | 'mode_keyword'
  | 'detector'
  | 'intent_fallback';
```

合并规则：

1. 同一段出现显式业务查询时，只保留 `business_system_query`，不同时生成 FDE 集成、能力回答或普通解释卡。
2. 其余候选按 actionType 去重；同 actionType 保留最高置信度，并合并来源信息。
3. 同一模式互斥候选继续交给 `ModeActionPolicy` 和 `selectPassedGateDecisions()` 仲裁。
4. `matchedKeyword` 和候选来源进入 DynamicAction 的可选诊断字段，便于测试和质量报告追踪；不得在用户可见卡片中显示内部技术词。

### 5.4 semantic gate 与 SignalStateTracker 的唯一衔接方式

扩展现有输入，不新增第二套信号状态机：

```ts
export interface SignalAssessmentInput {
  // 现有字段保持不变
  confirmedBySemanticGate?: boolean;
}
```

`DynamicActionEngine.assessSignals()` 仅在以下条件全部满足时传入 `confirmedBySemanticGate: true`：

1. 合并后的候选来源包含 `mode_keyword` 或 `business_query`。
2. 对应 semantic gate decision 为 `pass` 或 `fast_path`。

`SignalStateTracker.assess()` 的确定行为：

```text
confirmedBySemanticGate === true
  → status = confirmed
  → shouldStoreAction = true
  → confidence 保留 gate 返回值
  → autoSurfaceEligible 仍按 AUTO_MIN + 重复证据计算
```

其余 detector、intent fallback 和普通候选继续使用现有 `CARD_MIN` 逻辑。reject/defer、cooldown、dismiss cooldown、过期和 store deduplicate 均保持不变。

## 6. intent → actionType 确定性分流

新增纯函数：

```ts
resolveActionTypeForIntent({
  modeTemplateType,
  intentResult,
  latestTurn,
  businessTrigger,
}): string | null
```

分流优先级：

```text
显式业务查询
  > 模式内明确回答/证明请求
  > 模式默认 intent 映射
```

### 6.1 Sales

| intent/条件 | actionType |
| :--- | :--- |
| 显式业务系统查询 | `business_system_query` |
| `sales_capability_fit` + 明确能力问句 | `capability_fit_answer` |
| `sales_capability_fit` + 场景、痛点或适配描述 | `discovery_question` |
| `sales_contextual_proof_discovery` + 明确索要案例、ROI 或收益证明 | `case_study_request` |
| `sales_contextual_proof_discovery` + 仅描述需验证的场景 | `discovery_question` |
| `sales_proof_request` | `case_study_request` |
| `sales_pricing_objection` | `pricing_objection` |
| `sales_quote_request` | `pricing_request` |
| `sales_technical_requirements` | `technical_requirements` |
| `sales_buying_signal` | `buying_signal` |
| `sales_pain_discovery` / `sales_process_integration` / `sales_value_discovery` | `discovery_question` |

明确能力问句只识别问句语义，例如“是否支持”“有没有”“能不能”“可不可以”“有……功能吗”；单独出现产品对象或 `IQC` 不是能力回答依据。

### 6.2 FDE

| intent/条件 | actionType |
| :--- | :--- |
| 显式业务系统查询 | `business_system_query` |
| `fde_discovery` | `fde_discovery_probe` |
| `fde_integration` | `fde_integration_check` |
| `fde_security` | `fde_security_review` |
| `fde_risk` | `fde_risk_blocker` |
| `fde_agent_feasibility` | `fde_agent_feasibility` |
| `fde_success` | `fde_success_criteria` |
| `fde_next_step` | `fde_next_step` |

“讨论 QMS 到 MES 的同步方向”仍是 `fde_integration_check`；只有明确要求读取实时对象状态时才是 `business_system_query`。

### 6.3 Team-meet

| intent | actionType |
| :--- | :--- |
| `capture_action` | `action_item` |
| `capture_decision` | `decision_point` |
| `capture_risk` | `blocker_check` |
| `status_update` | `owner_deadline_check` |

普通行动项、决策和风险记录不主动检索知识源或业务系统。若整句是明确业务查询，则按全局优先级生成 `business_system_query`。

### 6.4 Recruiting

| intent | actionType |
| :--- | :--- |
| `recruiting_policy_question` | `candidate_concern` |
| `recruiting_risk_verification` | `candidate_experience_probe` |
| `recruiting_scorecard_gap` | `candidate_experience_probe` |
| `recruiting_bei_evidence_gap` | `candidate_experience_probe` |
| `recruiting_situational_evidence_gap` | `candidate_experience_probe` |
| `request_example` | `candidate_experience_probe` |

政策回答查可信资料；候选人证据追问只使用会议证据。

### 6.5 General / Interview / Lecture

保留现有映射，不把 Sales/FDE actionType 跨模式套用：

- General：`general_explain/general_summarize/general_assistance_request`
- Looking-for-work：`behavioral_question/intro_pitch/company_motivation`
- Technical interview：现有 coding/system-design actions
- Lecture：`concept_explanation/worked_example`

显式只读业务查询仍可使用全局 `business_system_query`，但必须通过相同的显式查询检测和 semantic gate。

## 7. Sales continuation 兼容边界

当前项目已有 `DynamicActionContinuation`：Sales 的 `discovery_question` 完成后，可在客户补充信息后派生 `capability_fit_answer`。

本方案保持该机制，并明确避免重复：

- 明确能力问句可直接生成 `capability_fit_answer`，该 actionType 不是 continuation parent，不注册后续派生任务。
- 场景、痛点或适配描述仍生成 `discovery_question`；只有这条路径继续使用现有 continuation。
- `sales_contextual_proof_discovery` 明确索要案例时直接生成 `case_study_request`；仅描述场景时可走 discovery continuation。
- 不修改 continuation 的超时、客户轮数和状态机。

## 8. semantic gate 与优先级

### 8.1 通用规则

- 所有候选都经过 `ModeEventClassifier.assess()`。
- 词表命中不是 pass 结果，只是候选证据。
- semantic gate 的 reject/defer 属于有证据的抑制，不计为候选漏生成。
- 通过 gate 后仍沿用 `SignalStateTracker` 的 cooldown 和去重；词表候选不得自动倒计时执行。

### 8.2 新 action policy

在 `ModeActionPolicy.ts` 为 `business_system_query` 增加全模式共享 policy：

- `riskLevel: 'medium'`
- `gateStrategy: 'preferred'`
- `fastPathEligible: false`
- `allowLocalFallbackOnCloudFailure: true`
- 本地 fallback 必须同时满足：显式查询动作、业务系统/业务对象锚点、只读查询语义。
- 不允许创建、修改、审批、提交、写回类操作进入该 action；这些请求返回“不支持写操作”的固定提示。

该共享 policy 应在 `getActionGatePolicy()` 中显式处理，避免复制到每个模式表后产生漂移。

## 9. actionType → ContextNeedDecision 契约

只使用现有三维结构：

```ts
interface ContextNeedDecision {
  material: 'required' | 'use_if_ready' | 'not_needed' | 'unknown';
  business: 'required' | 'use_if_ready' | 'not_needed' | 'unknown';
  screen: 'required' | 'use_if_ready' | 'not_needed' | 'unknown';
  // confidence/reason/decidedBy 保持现有字段
}
```

| actionType | material | business | screen | 失败行为 |
| :--- | :--- | :--- | :--- | :--- |
| `business_system_query` | `not_needed` | `required` | `not_needed` | 固定中文结果，不进入 LLM 猜测 |
| `capability_fit_answer` | `required` | `use_if_ready` | `not_needed` | 无可信资料时输出安全不足说明和最小验证步骤 |
| `case_study_request` | `required` | `not_needed` | `not_needed` | 无匹配资料时明确没有证明点，不编案例/ROI |
| `candidate_concern` | `required` | `not_needed` | `not_needed` | 要求招聘方确认，不编政策 |
| `fde_grounded_answer` | `required` | `use_if_ready` | `not_needed` | 区分已确认事实和待验证边界 |
| `fde_integration_check` / `fde_security_review` / `technical_requirements` | `use_if_ready` | `not_needed` | `not_needed` | 生成澄清或检查清单，不主动查询实时状态 |
| `discovery_question` | `use_if_ready` | `not_needed` | `not_needed` | 只使用已有上下文，不等待慢检索 |
| `action_item` / `decision_point` / `blocker_check` / `owner_deadline_check` | `not_needed` | `not_needed` | `not_needed` | 只基于转录 |
| `candidate_experience_probe` / `candidate_evidence_summary` | `not_needed` | `not_needed` | `not_needed` | 只基于候选人转录证据 |

必须移除“证据文本包含 PLM/BOM 就令 business required”这一决策方式：

- `BUSINESS_SIGNAL_PATTERN` 不再决定主动业务查询。
- `MATERIAL_SIGNAL_PATTERN` 不再把任意提及“材料/资料/案例”的 action 自动升级为主动 RAG。
- 主动外部检索只能由 actionType 契约决定。
- `screen` 仍可基于真实 screen evidence 决定。
- 新增契约测试：所有一等模式可生成的 actionType 均不得返回 `unknown`。

## 10. 业务系统查询 action

### 10.1 只保留一个 actionType

本轮只新增：

```ts
business_system_query
```

不再同时引入 `plm_object_status_query`。系统类型和对象类型属于查询元数据，不需要复制 actionType；这样可避免策略、UI、上下文和测试成倍分叉。

需要补全的位置：

- `DynamicActionEngine.syntheticTriggerFor()`：label、中文 prompt、安全 answer style。
- `DynamicActionProductContract`：userAction、whyNow、outputPromise，outputType 使用 `spoken_response`。
- `ModeActionPolicy.getActionGatePolicy()`：共享 policy。
- `ContextNeedDecision.buildDynamicActionContextNeedDecision()`：`business: required` 的确定性分支。
- renderer 类型和 mode event：继续透传 actionType、latestTurn、sourceIntent、context decision。

### 10.2 显式查询识别

候选生成和执行必须复用同一个 `detectBusinessSystemTrigger()`，不得分别维护两套正则。

必须同时满足：

1. 查询动作：`查一下/查询/确认一下/去系统里看一下/帮我看一下` 等只读动作。
2. 系统或对象锚点：PLM/Windchill/QMS/ERP/MES/CRM，或 BOM/ECO/ECN/CAPA/物料/质量事件/合同/客户档案等可查询对象。

负向规则：

- “PLM 里 BOM 流程比较复杂”不是查询。
- “QMS 到 MES 的数据方向怎么设计”是实施澄清，不是实时状态查询。
- 创建、修改、审批、提交、删除、写回等请求不得当作只读查询执行。

### 10.3 原始查询文本

新增纯函数：

```ts
resolveBusinessQueryText({ question, source, modeEvent }): string | undefined
```

确定规则：

```text
dynamic_action + actionType === business_system_query
  → modeEvent.latestTurn
  → question
  → 无有效原话则返回 missing_query_anchor

manual/launcher
  → question
```

`modeEvent.retrievalQuery` 不发送给 MCP；它是合成检索语句，不是原始业务指令。`promptInstruction` 只给回答生成器，不参与业务触发检测。

`prepareBusinessContext()` 的 cache key 和 `BusinessSystemContextService.resolve({ question })` 都使用同一个 resolved business query，避免缓存和执行使用不同文本。

### 10.4 PLM/QMS/ERP/MES/CRM 精确路由

为避免 generic 默认源误路由，扩展：

```ts
type BusinessSystemSourceKind =
  | 'plm'
  | 'qms'
  | 'erp'
  | 'mes'
  | 'crm'
  | 'business_system';
```

实施约束：

- 现有 `plm/qms/business_system` 配置保持兼容，不需要数据库迁移；数据保存在 CredentialsManager 的加密 JSON 结构中。
- 设置页增加 ERP、MES、CRM 类型选项；preload、renderer 类型和 IPC 输入校验同步更新。
- 明确 sourceHint 时只选择相同 kind 的启用源，不回退到其它系统默认源。
- 没有 system hint 时：优先唯一 default；没有 default 且只有一个启用源时使用该源；否则返回 `ambiguous`，不得猜测。
- PLM 继续走 Windchill Adapter；QMS/ERP/MES/CRM/business_system 继续走 `business_context.query` MCP。

### 10.5 MCP 返回结果契约

`normalizeBusinessMcpToolResult()` 必须支持并校验：

- `status`
- `sourceName`
- `summary`
- `evidence`
- `items`
- `errorCode`

固定安全上限：

| 字段 | 上限 |
| :--- | :--- |
| sourceName | 80 字符 |
| summary | 1200 字符 |
| records/items | 最多 5 条 |
| 每条记录字段 | 最多 16 个 |
| record title | 120 字符 |
| 字段名 | 80 字符 |
| 字段值 | 300 字符 |

`items` 规范化规则：

- 只接受普通对象。
- 只保留字符串、有限数字和布尔值。
- 忽略 `null`、`undefined`、数组、嵌套对象、函数和无法安全字符串化的值。
- 不递归展开嵌套结构。
- 字段在截断前先去除多余空白和控制字符。
- 超出记录数、字段数或字段长度的内容直接截断，并在内部 metadata 记录省略数量；不得把被省略原文写入日志。

成功的最低条件：

- 非空 summary；或
- 至少一条经过字段长度和数量限制的结构化 evidence record；或
- items 能安全规范化为 evidence record。

`status: ok` 但无任何有效内容时统一转换为 `no_result`，不得转换为笼统 `error`。

### 10.6 禁止 LLM 猜测业务状态

对于 `actionType === 'business_system_query'`：

- fixed reply 继续在 `runWhatShouldISay()` 前短路。
- 成功 context 也在 LLM 前短路，由 `BusinessSystemContextService` 提供确定性 `answer`。
- answer 只格式化 sourceName、记录标题和返回字段；不得补充结果中不存在的状态、版本、负责人或时间。
- 保存正常 answer context trace，标记 `businessSystemStatus: available`。
- 不把 `business_system_query` 塞进现有 capability runtime validator；该 action 的可信边界由“确定性格式化 + LLM bypass”保证。

确定性成功输出只能使用以下格式之一。

结构化记录：

```text
已从 {sourceName} 查询到以下结果：

记录 1：{title}
- {fieldName}: {fieldValue}

共查询到 {recordCount} 条记录。
```

只有 summary：

```text
根据 {sourceName} 的查询结果：
{summary}
```

若同时存在 evidence/items 和 summary，优先输出结构化记录；summary 只作为没有结构化记录时的 fallback。不得添加查询结果中不存在的状态解释、业务建议或推断。

固定失败文案至少覆盖：

| 状态 | 行为 |
| :--- | :--- |
| `not_configured` | 提示先配置对应业务系统知识源 |
| `missing_query_anchor` | 提示补充系统、对象或编号 |
| `ambiguous` | 提示指定要查询的业务系统或对象 |
| `unsupported_operation` | 明确当前只支持只读查询 |
| `auth_failed` | 提示认证失败，不泄露凭据 |
| `timeout` | 提示查询超时 |
| `unavailable` / `error` | 提示服务不可用或查询失败 |
| `no_result` | 提示未查到匹配对象或状态 |

## 11. 知识源回答的可信边界

### 11.1 Capability

`capability_fit_answer` 保留现有 runtime validation：

- material required。
- 可以使用已就绪的只读 business context，但不能主动查询业务系统。
- 没有可信材料时输出“资料不足 + 最小验证步骤”。
- 不能承诺自动写回、客户案例、ROI、价格或合同条款。

### 11.2 Case study

`case_study_request` 当前虽然在 `DynamicActionAcceptedOutputEvaluator` 有检查，但没有进入 `DynamicActionRuntimeValidationPolicy` 的实时执行链。本方案确定只使用现有 Runtime Validation 架构，不在 IPC 增加第二套特殊 guard：

```ts
export type DynamicActionRuntimeEvidenceKind =
  | 'external_capability'
  | 'external_case_material'
  | 'external_policy'
  | 'transcript_evidence';

const POLICIES = {
  // 现有策略保持不变
  case_study_request: {
    actionType: 'case_study_request',
    evidenceKind: 'external_case_material',
  },
};
```

确定行为：

- `DynamicActionRuntimeGrounding` 对 `external_case_material` 只接受 uploaded material/PPTX，不接受 business context。
- 有匹配材料时，LLM 只能引用注入材料，输出继续经过现有 `case_study_request` evaluator。
- 无匹配材料或 runtime evaluation 失败时，使用下列固定中文 fallback：

```text
当前资料中没有找到匹配的客户案例或收益数据。可以先确认客户更关注的行业、业务场景和指标，再补充对应证明材料。
```

- 不调用业务系统，不编客户名、收益、百分比或 ROI。

### 11.3 Recruiting policy

保留 `candidate_concern` 的现有 material required 和 runtime validation；不得把候选人经历追问升级为资料检索。

## 12. 文件级实施任务

### P0：消除词表候选漏生成

1. `electron/llm/IntentKeywordDefaults.ts`
   - 新增 `IntentKeywordMatch`。
   - `matchIntentKeywords()` 返回 intent + matchedKeyword。
2. `electron/llm/IntentClassifier.ts`
   - 扩展 `IntentResultSource` 和 `IntentResult`。
   - 活跃模式词表匹配先于 cloudFirst。
   - 透传 `source: mode_keyword` 和 matchedKeyword。
3. `electron/services/dynamic-actions/DynamicActionEngine.ts`
   - 放行 mode_keyword 候选。
   - 新增 `resolveActionTypeForIntent()` 和 Sales 分流 helper。
   - 在 action 诊断字段保留候选来源和 matchedKeyword。
   - 对 mode_keyword/business_query 的 gate pass 设置 `confirmedBySemanticGate`。
4. `electron/services/dynamic-actions/DynamicAction.ts`、`src/types/electron.d.ts`
   - 同步可选诊断字段。
5. `electron/services/dynamic-actions/SignalStateTracker.ts`
   - 增加 `confirmedBySemanticGate` 输入。
   - 仅让显式候选的 gate pass 绕过 CARD_MIN；不改变 auto-surface、cooldown 和普通候选阈值。

### P0：消除错误外部上下文调用

1. `electron/services/context/ContextNeedDecision.ts`
   - 用 actionType 集合/显式分支替代 material/business 证据文本正则。
   - 新增 business_system_query、fde_grounded_answer、case study 等完整契约。
2. `electron/services/context/WhatToSayContextPreparation.ts`
   - 增加 `resolveBusinessQueryText()`。
   - business cache key 和 resolve 使用同一原始查询。
   - `retrievalQuery` 只继续用于 material RAG。
3. `electron/services/dynamic-actions/DynamicActionRuntimeValidationPolicy.ts`
   - 为 case_study_request 增加唯一的 `external_case_material` Runtime Validation 策略和固定中文 fallback。
4. `electron/services/dynamic-actions/DynamicActionRuntimeGrounding.ts`
   - external_case_material 只注入 uploaded material/PPTX，不注入 business context。

### P0：新增只读业务系统查询卡

1. `electron/services/business-system/BusinessSystemTriggerDetector.ts`
   - 收紧为“只读查询动作 + 系统/对象锚点”。
   - 增加 ERP/MES/CRM 识别和写操作拒绝。
2. `electron/services/dynamic-actions/DynamicActionEngine.ts`
   - 在普通 intent 分流前生成 business_system_query 候选。
   - 显式业务查询独占当前 segment。
3. `electron/services/dynamic-actions/ModeActionPolicy.ts`
   - 增加全模式共享 semantic policy。
4. `electron/services/dynamic-actions/DynamicActionProductContract.ts`
   - 增加用户可见产品契约。
5. `electron/services/business-system/BusinessSystemContextService.ts`
   - 精确选源、ambiguous 返回、确定性成功 answer。
6. `electron/services/business-system/BusinessMcpClient.ts`
   - 完整规范化 summary/evidence/items。
7. `electron/ipcHandlers.ts`
   - 对 business_system_query 的成功和失败都在 LLM 前短路，并保存 trace。

### P1：业务源类型和设置同步

同步更新：

- `electron/services/business-system/BusinessSystemTypes.ts`
- `electron/services/CredentialsManager.ts`
- `electron/ipcHandlers.ts` 的 source kind 校验
- `electron/preload.ts`
- `src/types/electron.d.ts`
- `src/components/settings/BusinessSystemKnowledgeSourcesSettings.tsx`

### P2：设置文案和可观测性

`src/components/settings/ModesSettingsBase.tsx` 文案改为：

```text
意图触发词
命中后会生成对应智能卡片候选，并由语义判断决定是否展示。
```

质量诊断至少记录：modeTemplateType、intent、actionType、candidateSource、matchedKeyword、semantic decision、contextNeedDecision、business status。不得记录原始转录、完整 prompt 或凭据。

## 13. 测试计划

先写失败测试，再实施代码。

### 13.1 IntentClassifier

目标文件：`electron/llm/__tests__/IntentClassifier.test.mjs`

- 活跃词表命中返回 `source: mode_keyword` 和 matchedKeyword。
- General 模式 cloudFirst 开启时，精确词表匹配仍优先。
- 词表未命中后仍进入现有 cloud/pattern fallback。
- 空词列表保持“该 intent 不匹配”的现有语义。

### 13.2 DynamicActionEngine

目标文件：`electron/services/__tests__/DynamicActionEngine.test.mjs`

- `sales_capability_fit + IQC + 明确能力问句` 形成 capability_fit_answer 候选并进入 gate。
- 同样命中 IQC 但只是场景描述时形成 discovery_question。
- `sales_contextual_proof_discovery + 明确案例收益请求` 形成 case_study_request。
- FDE/Team-meet/Recruiting 的 mode_keyword 候选不受 `0.85` 门槛丢弃。
- semantic gate reject 时不显示卡片。
- mode_keyword/business_query 的 semantic gate pass 即可存储普通卡片，即使 gate confidence 低于 CARD_MIN。
- 上述显式候选不会因此获得 auto-surface 资格。
- 显式业务查询只生成 business_system_query，不同时生成 FDE 或 Sales 卡。
- 同 actionType 的 detector 和 mode_keyword 候选只保留一个。

### 13.3 ContextNeedDecision

目标文件：`electron/services/__tests__/ContextNeedDecision.test.mjs`

- business_system_query：business required，material not_needed。
- case_study_request/capability_fit_answer/candidate_concern：material required，business 不主动查询。
- FDE 集成文本即使包含 PLM/BOM，也不因文本正则变成 business required。
- Team-meet action/decision/risk 不调用 material/business。
- 一等模式所有可生成 actionType 都不返回 unknown。

### 13.4 查询文本透传

目标文件：`electron/services/__tests__/WhatToSayContextPreparation.test.mjs`

输入：

```text
question = undefined
modeEvent.actionType = business_system_query
modeEvent.latestTurn = 查一下 PLM 里 golf car 的 BOM 发布了没有
modeEvent.retrievalQuery = fde business entities golf car BOM
promptInstruction = 帮我回答客户这个问题
```

断言：

- `BusinessSystemContextService.resolve().question` 等于完整 latestTurn。
- 不等于 promptInstruction。
- 不等于 retrievalQuery。
- cache key 使用相同原始查询。

### 13.5 BusinessSystemTriggerDetector

目标文件：`electron/services/__tests__/BusinessSystemTriggerDetector.test.mjs`

- PLM/QMS/ERP/MES/CRM 的明确只读查询均命中正确 sourceHint。
- “PLM 里 BOM 流程比较复杂”不命中。
- “QMS 到 MES 的数据方向怎么设计”不命中业务状态查询。
- 创建/修改/审批/写回请求返回 unsupported_operation，不调用 MCP。

### 13.6 Business system routing 与 MCP

目标文件：

- `electron/services/__tests__/BusinessSystemContextService.test.mjs`
- `electron/services/__tests__/BusinessSystemContextService.comprehensive.test.mjs`
- `electron/services/__tests__/BusinessMcpClient.test.mjs`
- `electron/services/__tests__/BusinessSystemMainChain.contract.test.mjs`

覆盖：

- ERP 查询只选择 ERP source，不回退 PLM default。
- 无 hint、多启用源且无唯一 default 时返回 ambiguous。
- evidence-only、items-only、summary-only 成功结果都能正确规范化。
- 超过 5 条记录、16 个字段或字段长度上限时按固定上限截断并记录省略数量。
- items 中嵌套对象、数组和无效数值被忽略，不进入确定性答案。
- status ok 但无有效内容转 no_result。
- business_system_query 成功和失败都不会调用 `runWhatShouldISay()`。
- trace 正确记录业务状态，且日志不包含原始转录和凭据。

### 13.7 Runtime grounding

目标文件：

- `electron/services/__tests__/DynamicActionRuntimeGrounding.test.mjs`
- `electron/services/__tests__/DynamicActionRuntimeEvaluation.test.mjs`
- `electron/services/__tests__/SalesDynamicActionGrounding.test.mjs`

覆盖：

- case_study_request 无材料时只能返回无匹配证明点。
- capability_fit_answer 无材料时只能返回资料不足和最小验证步骤。
- business_system_query 不进入 LLM runtime evaluator。

### 13.8 UI 与 IPC 契约

目标文件：

- `electron/services/__tests__/DynamicActionUiBridge.contract.test.mjs`
- `electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs`
- `electron/services/__tests__/BusinessSystemSettingsUi.test.mjs`

覆盖 actionType/latestTurn/context decision 透传、设置类型选项和新意图词文案。

## 14. 验收场景

### 场景 A：Sales 能力问句

配置：`sales_capability_fit = IQC`

输入：

```text
你们的 QMS 有 IQC 检验功能吗？
```

期望：

- mode_keyword 命中 IQC。
- 生成 capability_fit_answer 候选。
- 经过 Sales semantic gate。
- 用户接受后主动检索资料，不调用业务系统。
- 无资料时不承诺支持 IQC。

### 场景 B：Sales 案例请求

输入：

```text
你们在跨境电商行业有哪些案例，他们有什么收益？
```

期望：

- 生成 case_study_request。
- 只检索案例/材料知识源。
- 不调用 PLM/QMS/ERP/MES/CRM。
- 无材料时明确没有匹配案例，不编客户或收益。

### 场景 C：FDE 集成讨论

配置：`fde_integration = IQC`

输入：

```text
IQC 检验数据要从 QMS 同步到 MES，这个数据方向和读写边界怎么确认？
```

期望：

- 生成 fde_integration_check。
- 不调用实时业务系统。
- 输出系统、数据方向、权限、owner 和验证产物检查项。

### 场景 D：实时业务对象查询

输入：

```text
查一下 PLM 里 golf car 的 BOM 发布了没有？
```

期望：

- 只生成 business_system_query。
- 用户接受后把完整原话发送给 PLM Adapter/MCP。
- 有真实结果时确定性展示返回字段。
- 无配置、鉴权失败、超时或无结果时返回对应中文固定提示。
- 不进入知识源 RAG，不进入 LLM 状态推断。

### 场景 E：Team-meet 行动项

配置：`capture_action = IQC`

输入：

```text
IQC 检验流程的问题我来负责，周五前给出方案。
```

期望：

- 生成 action_item。
- 只使用转录提取负责人、动作、截止时间。
- 不调用知识源或业务系统。

### 场景 F：负向误触发

输入：

```text
PLM 里 BOM 流程比较复杂，我们先讨论接口边界。
```

期望：

- 不生成 business_system_query。
- 不调用业务系统。
- 根据模式可生成 FDE 集成澄清或 Sales discovery 候选，并继续经过 semantic gate。

## 15. 验证命令

```bash
npm run build:electron
npm run typecheck:electron
node --test electron/llm/__tests__/IntentClassifier.test.mjs
node --test electron/services/__tests__/DynamicActionEngine.test.mjs
node --test electron/services/__tests__/ContextNeedDecision.test.mjs
node --test electron/services/__tests__/WhatToSayContextPreparation.test.mjs
node --test electron/services/__tests__/BusinessSystemTriggerDetector.test.mjs
node --test electron/services/__tests__/BusinessSystemContextService.test.mjs
node --test electron/services/__tests__/BusinessMcpClient.test.mjs
node --test electron/services/__tests__/BusinessSystemMainChain.contract.test.mjs
node --test electron/services/__tests__/DynamicActionPromptInstructionWiring.test.mjs
npm test
```

验收必须记录：命令、退出码、失败项；不得把开发前已有失败描述成此次改动通过。

## 16. 非目标

- 不通过继续堆叠 `DynamicActionDetector.ts` 的产品词正则来解决用户配置问题。
- 不取消 semantic gate、cooldown 或去重。
- 不允许关键词命中后无条件弹卡。
- 不让所有 action 默认查询知识源。
- 不把业务系统 MCP 当作普通问答 fallback。
- 不支持业务系统创建、修改、审批、删除或写回。
- 不重构 DynamicActionContinuation 状态机。
- 不在本轮引入多标签 intent 分类或新的数据库表。

## 17. 实施完成定义

只有同时满足以下条件才可声明完成：

1. P0、P1、P2 文件任务全部实施，没有留待开发者临场决定的映射或失败行为。
2. 六个验收场景及其负向用例全部有自动化测试，且全部通过。
3. 本文第 15 节列出的目标测试全部通过，退出码均为 `0`。
4. `npm run build:electron` 和 `npm run typecheck:electron` 均通过，退出码为 `0`。
5. `npm test` 已运行，且相对开发前基线没有新增失败；如存在历史失败，必须提供开发前测试名称、失败信息和数量作为可核对基线，不能只写“无关失败”。
6. 所有一等模式能够生成的 actionType 都有自动化契约测试证明 `ContextNeedDecision` 不为 `unknown`。
7. 代码中不存在由 PLM/BOM 等普通文本提及直接升级 `business: required` 的路径，对应负向测试通过。
8. `business_system_query` 的原始查询透传、精确业务源路由、确定性结果格式化和 LLM bypass 均有契约测试保护且测试通过。
9. 设置文案准确表达“生成候选，由语义判断决定是否展示”，不承诺关键词必然弹卡，并有 UI 契约测试保护。
10. 最终实施报告必须列出变更文件、目标测试结果、全量测试基线对比和任何未完成项；存在任一未完成项、新增测试失败或未验证高风险链路时，不得声明完成。
