# 实时回答 LLM 路径审计

更新时间：2026-07-04

## 判定口径

- `migrated`：已使用 `RealtimeContextOrchestrator`，或在调用链上有等价的 trace、scope、降级状态保护。
- `pending`：会影响会议现场回答，但还没有统一进入上下文编排或缺少完整 trace。
- `exempt`：非实时回答、后台任务、测试路径、研究/总结路径，或不承载 transcript 上下文。

实时路径必须遵守 provider data scope，不持久化原始 transcript、prompt、截图正文或 evidence text。

## 路径清单

| 入口 | 调用方法 | 数据 scopes | 状态 | Trace / 降级 | 下一步 |
| --- | --- | --- | --- | --- | --- |
| `generate-what-to-say` IPC | `BusinessSystemContextService`、`MaterialRagRetriever`、`buildRealtimeContextPlan()`、`IntelligenceEngine.runWhatShouldISay()` | transcript、reference_files、screenshots、business_system | `migrated` | 保存 answer context trace、sourceStatus、degradedReason、retrievalTimingMs、contextFingerprint | 继续把更多现场回答入口收敛到同一 plan 输出 |
| `IntelligenceEngine.runWhatShouldISay()` | `WhatToAnswerLLM.generateStream()` | transcript、screenshots、reference_files、mode context | `migrated` | 通过 `traceSink` 接收 `WhatToAnswerTraceMetadata`，并向 IPC trace 合并 | 保持 `traceSink` 为所有实时答案调用的必需路径 |
| `WhatToAnswerLLM.generateStream()` | `LLMHelper.streamChat()` | transcript、screenshots、reference_files、profile_history | `migrated` | 输出 contextUsed、sourceStatus、degradedReasons、observability | 后续补更多按 mode 的质量 fixture |
| `LLMHelper.streamChat()` | provider streaming fallback | transcript、screenshots、reference_files、profile_history | `migrated` | 使用 provider scope 推断和路由 fallback；低层不负责 answer trace | 不直接新增业务上下文，继续由上层传入已编排 context |
| 动态动作云端 semantic gate | `IntelligenceEngine.classifyDynamicActionWithCloud()` -> `LLMHelper.generateContentStructured()` | transcript | `migrated` | `SemanticGateTrace` 记录 cloud/local、decision、reason、degradedReason | 后续把云端不可用率纳入诊断样本 |
| Context quality diagnostics | `ContextQualityDiagnosticsCollector` -> `summarizeContextQualityDiagnostics()` -> `context-quality-smoke-report.mjs` | action trace summary、source types、timing、answer metrics、code hint trace summary | `migrated` | 内部诊断聚合 pass/reject/defer、fallback、降级原因、context omission、retrieval timing 和 CodeHint 状态；不记录 transcript、prompt、截图或 evidence text；采集器为有界最近样本，脚本无 JSON 输入时只标记当前进程快照 | 保持为开发诊断入口，不作为 renderer 产品 UI 依赖 |
| Screen understanding | `ScreenUnderstandingService` -> vision provider fallback | screenshots | `migrated` | IPC 合并 screenContextStatus、vision provider attempt、screen_context_failed | 保持截图 hash/状态可见，不持久化截图正文 |
| Code hint | `generate-code-hint` IPC -> `IntelligenceEngine.runCodeHint()` -> `CodeHintLLM.generateStream()` | screenshots、transcript | `migrated` | 独立 realtime tool trace；IPC 入口先执行 screenshots scope gate，LLM 层再次过滤 provider data scope；scope denied 时丢弃对应上下文或返回 blocked degraded result；不记录原始 transcript、prompt、截图路径、截图内容或代码正文 | 后续可评估是否并入 answer trace persistence，但第一版已具备等价 trace/scope 保护 |
| Suggestion trigger | `handleSuggestionTrigger()` -> `runWhatShouldISay()` | transcript | `migrated` | 复用 What Should I Say trace；动态动作 active 时抑制重复回答 | 保持与动态动作 dedupe 的合约测试 |
| Recap / clarify / brainstorm | `RecapLLM`、`ClarifyLLM`、`BrainstormLLM` | transcript / context | `exempt` | 非主实时答案路径 | 不纳入当前 P0 smoke，后续单独评估 |
| Research / profile intelligence | research services and dossier builders | profile_history、reference_files、web/company data | `exempt` | 独立研究 trace / progress | 不阻塞会议现场 2 秒回答路径 |
| Post-call workflow | `PostCallWorkflow` | post_call_summary、transcript | `exempt` | post-call safety tests | 不纳入实时上下文编排当前冲刺 |

## 当前结论

- 主实时回答链路已经以 `generate-what-to-say` IPC 为中心接入 `RealtimeContextOrchestrator`、answer trace、source status 和降级原因。
- 动态动作语义门控不走完整上下文编排，但已经有等价的动作级 trace 和 provider scope 保护，因此本轮标记为 `migrated`。
- `ContextQualityDiagnosticsCollector` 已作为内部开发诊断入口接入实时回答 context plan、动态动作 gate trace、CodeHint trace 和 answer quality metrics 的脱敏摘要；独立脚本默认无法跨进程读取 Electron 主进程内存，会显式标记 `process_local_snapshot`，需要真实样本时应传入 JSON 快照。
- `CodeHintLLM` 已从 pending 收口为独立工具流：具备 IPC screenshots scope gate、LLM 层 provider data scope enforcement、redacted code hint trace 和 diagnostics summary。它尚未写入持久化 answer trace，这是后续产品化诊断选择，不再阻塞首轮实时 LLM 路径审计。
- `LLMHelper.streamChat()` 是底层 provider 执行器，不应直接承担业务上下文选择；上层必须传入已编排 context 和 scopes。

## 后续动作

1. 评估是否需要把 `CodeHintLLM` 的独立 trace 纳入持久化 answer trace 或产品 UI 诊断。
2. 为所有调用 `runWhatShouldISay()` 的入口添加 contract test，确保 `traceSink` 不被绕过。
3. 每次新增实时 LLM 入口，都必须在本文件登记状态、scopes、trace 和降级策略。
4. 新增或修改实时 LLM 路径、prompt、provider scope、上下文选择或动态动作规则时，必须先运行 `npm run test:quality:changed`。如果输出 `Context quality gate required.`，提交前必须运行 `npm run test:quality:gate`；连续本地验证可使用 `npm run test:quality:gate:no-build`。
