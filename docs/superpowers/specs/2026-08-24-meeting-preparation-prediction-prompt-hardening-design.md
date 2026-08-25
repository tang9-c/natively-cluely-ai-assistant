# 会议准备预测提示词强化设计

## 背景

真实供应商能够完成 `meeting-preparation-predict` 请求，但返回的预测问题不满足现有 `generationBundleSchema`：`questions[].rationale` 和 `questions[].knowledgeRequirements` 被返回为字符串，而 Schema 要求字符串数组。生成流程因此在资料检索、证据评估和结果保存之前终止。

## 目标

通过强化预测提示词，降低真实模型返回错误字段类型的概率，使用户能够从“确认信息与模式”进入“查看准备结果”。

## 方案

只修改 `buildPredictionPrompt`：

- 明确只返回一个 JSON 对象，不添加解释或 Markdown 代码块。
- 明确顶层字段：
  - `historySummary` 为字符串数组；
  - `commitments` 为 `{ text: string }` 对象数组；
  - `questions` 为 0–3 个问题对象的数组。
- 明确每个问题对象包含：
  - `question: string`；
  - `keyMomentType: string`；
  - `rationale: string[]`；
  - `knowledgeRequirements: string[]`；
  - `requiresInternalEvidence: boolean`。
- 提供一个满足 Schema 的合法 JSON 示例，并明确示例内容不可照抄。
- 没有历史会议时，`historySummary` 和 `commitments` 必须返回空数组。

不增加输出归一化或宽松类型转换，不修改 Schema、数据库、IPC、资料检索、证据评估、供应商路由或页面流程。

## 错误处理与隐私

结构校验失败时继续拒绝结果并保留用户现有内容。安全诊断只记录错误类型、字段路径和校验错误码，不记录模型原文、提示词、会议描述、历史会议内容或资料内容。

## 测试与验收

- 增加预测提示词契约测试，锁定完整 JSON 结构、数组类型、布尔类型和合法示例。
- 先运行测试确认旧提示词失败，再实施最小提示词修改并确认通过。
- 运行会议准备服务定向测试、Electron 类型检查和项目完整测试集。
- 使用真实供应商完成以下全流程：描述会议 → 确认并推荐模式 → 生成准备结果 → 查看准备结果。
- 确认生成阶段进入资料检索或按问题类型跳过资料检索，并最终保存结果。

## 已知限制

提示词不是强制结构化输出，无法保证所有模型和输入始终符合 Schema。本设计接受这一限制，以保持与已批准 A 方案一致的最小改动；若同类类型错误继续出现，再单独评估保守归一化或供应商原生结构化输出。
