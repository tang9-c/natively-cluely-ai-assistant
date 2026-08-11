# 简化版长会议技能处理设计

## 背景

会议转录技能导出当前把完整转录放入一次 QCLOUD 非流式请求，并允许最多生成 16,000 token。技能请求还会默认启用 `turbo` 模型和 medium reasoning。长中文转录的 token 数又被按“字符数除以 4”低估，导致请求在 120 秒总超时内无法完成。

本设计只解决长会议技能超时，不引入后台任务、持久化队列、缓存、断点续传或新的 UI 状态。

## 目标

- 短转录继续使用一次模型调用，保持现有交互和导出行为。
- 长转录使用简单的两阶段处理，避免把完整原文放入一次模型请求。
- 降低长转录 Map 阶段的推理和输出开销。
- 保留现有同步 IPC、Markdown 文件导出、数据范围校验和失败提示。
- 每次 QCLOUD 调用有独立的 120 秒超时；多阶段流程不再共用一个 120 秒总计时器。

## 非目标

- 不增加数据库表或后台任务系统。
- 不增加缓存、断点续传和任务恢复。
- 不修改技能文件格式或技能激活机制。
- 不增加 renderer 进度条或分块进度事件。
- 不改变非 QCLOUD 提供商的路由规则。

## 执行路径

### Token 估算

转录 token 使用保守的中文感知估算：

```text
CJK 字符数 + ceil(非 CJK 字符数 / 4)
```

CJK 范围至少覆盖 `U+3400–U+4DBF` 和 `U+4E00–U+9FFF`。空白和 Markdown 标记计入非 CJK 字符。

### 短转录

估算输入不超过 48,000 token 时，保持一次 `chatWithGemini()` 调用：

- 使用完整转录。
- 使用完整技能 prompt。
- 输出上限改为 6,144 token。
- 保持现有技能默认 reasoning 行为，避免改变短任务质量。
- 单次调用超时 120 秒。

### 长转录

估算输入超过 48,000 token 时执行两阶段处理。

#### Map

- 按转录换行边界累计切分，每块目标上限 24,000 token。
- 不拆分普通说话轮次。
- 单行超过 24,000 token 时按字符边界继续切分，保证每块不超过上限。
- 每个块仍携带原始时间戳和说话人文本。
- 最多同时执行 2 个 Map 调用。
- 每个 Map 调用使用同一个技能 prompt，只提取与该技能有关的事实和要点，不生成最终文档。
- 每块输出上限 800 token。
- 显式设置 `thinking: disabled`，不发送 reasoning effort。
- 每个调用独立超时 120 秒。

#### Reduce

- 按原始块顺序拼接 Map 结果，并标明块编号。
- 使用同一个技能 prompt 生成最终 Markdown。
- 输出上限 6,144 token。
- 显式设置 `thinking: enabled` 和 `reasoning_effort: minimal`。
- 单次调用超时 120 秒。

任一 Map 或 Reduce 调用失败时，沿用现有固定失败结果，不写出不完整文件，也不自动重试。

## 参数优先级

当前 `LLMHelper` 只要发现 `activeSkill`，就强制覆盖调用方传入的 thinking 和 reasoning effort。本设计调整为：

```text
显式 chatPromptOptions 参数 > activeSkill 默认值 > provider 默认值
```

没有显式参数的现有技能调用仍保持 `thinking: enabled` 和 medium reasoning。只有长转录 Map/Reduce 显式选择更轻的配置。

## 超时语义

移除包裹完整导出流程的单个 120 秒 `Promise.race`。改为每次模型调用创建独立 AbortController 和 120 秒计时器：

- 短路径：一个 120 秒调用预算。
- 长路径：每个 Map 各有 120 秒，Reduce 另有 120 秒。
- 某次调用超时后立即中止该请求并停止后续处理。

这不会承诺整个长任务在 120 秒内完成，但可以避免一个慢块无限等待，也不会让前面成功的块消耗后续 Reduce 的超时预算。

## 文件职责

- `electron/services/TranscriptSkillExportService.ts`
  - 中文感知 token 估算。
  - 直接/分块路径选择。
  - 转录分块、两路并发 Map、Reduce 和逐调用超时。
- `electron/llm/QCloudLlmConstants.ts`
  - 定义 48K、24K、800、6,144 和 120 秒等任务常量。
- `electron/LLMHelper.ts`
  - 允许调用方显式 thinking/reasoning 参数覆盖 active-skill 默认值。
- `electron/services/__tests__/TranscriptSkillExport.contract.test.mjs`
  - 更新结构契约，并保留 IPC、隐私范围和导出边界检查。
- `electron/services/__tests__/TranscriptSkillExport.behavior.test.mjs`
  - 使用注入的技能和 LLM 测试短路径、中文估算、分块、并发上限、Map/Reduce 参数及失败行为。
- `electron/services/__tests__/QCloudLlmConstants.test.mjs`
  - 验证常量与参数优先级。

## 测试要求

- 中文字符不能再按四分之一 token 估算。
- 48K 以内只调用一次 LLM，输出上限为 6,144。
- 超过 48K 时先 Map 后 Reduce，不把完整转录放入 Reduce。
- Map 块不超过约 24K token，块顺序稳定，最多并发 2 个。
- Map 使用 800 token、关闭 thinking；Reduce 使用 6,144 token、minimal reasoning。
- 每次调用获得不同的 AbortSignal，某个调用超时或失败时不写文件。
- 未显式覆盖参数的其他技能继续使用 medium reasoning。
- 聚焦测试、Electron 类型检查、完整 `npm test` 和质量冒烟测试全部通过。

## 验收标准

- 短会议导出行为保持兼容。
- 长会议不再作为单个完整转录请求发送给 QCLOUD。
- 生产代码没有全流程 120 秒总超时。
- 没有新增数据库、后台任务或 UI 协议。
- 所有新增行为都有先失败后通过的自动化测试。
