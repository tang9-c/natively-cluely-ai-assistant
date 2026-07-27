# QCLOUD 摘要、标题与智能卡片最小修复方案

更新日期：2026-07-27

## 目标

用最小代码改动解决三个已确认问题：

1. 会议标题和摘要不再因 QCLOUD 模型或短超时失败。
2. 5 万字符以内的会议转录默认单次生成摘要，并稳定返回合法 JSON。
3. 智能卡片的两个云端判断不再因 2.5 秒预算过短而频繁超时。

## 已确认依据

- `turbo` 处理约 5 万字符摘要时延迟波动明显，不适合作为 60 秒摘要默认模型。
- `lite32k` 使用修正后的 JSON prompt、4,096 输出 tokens 和 60 秒超时，单次处理约 5 万字符连续 5 次成功：
  - 耗时约 20.4-30.0 秒。
  - 平均约 24.6 秒。
  - 5 次均返回完整、可解析 JSON。
- 仅把 JSON schema 放在 system prompt 时，`lite32k` 可能返回非 JSON；在 user message 最末尾再次声明 schema 后可以稳定解析。
- 智能卡片的两个结构化请求当前均使用 2.5 秒超时，低于已经观察到的正常响应时间。

## 最小修改

### 1. QCLOUD 模型和预算

修改 `electron/llm/QCloudLlmConstants.ts`：

- 普通聊天、技能、标题和摘要继续使用 `lite32k`。
- 技能和会议摘要单次 QCLOUD 超时保持 60 秒。
- 使用三个任务级输出预算：
  - 标题：64 tokens。
  - 核心摘要：4,096 tokens。
  - 摘要增强：2,048 tokens。
- 不再由业务代码主动选择 `turbo`。

### 2. 标题

修改 `electron/LLMHelper.ts` 和 `electron/MeetingPersistence.ts`：

- 给 `generateMeetingSummary()` 增加第四个可选参数 `options?: { maxOutputTokens?: number }`，仅用于覆盖本次 QCLOUD 请求的输出预算。
- 标题调用传入 64 tokens。
- 保留当前标题独立 `try/catch`；标题失败继续使用现有 fallback title，不影响摘要。
- 不增加标题状态字段、重试逻辑或新接口。

### 3. 摘要

修改 `electron/services/post-call/PostCallSummaryGenerator.ts`：

- 保留现有 24,000 字符分块器和 1,200 字符重叠，不重写分块算法。
- 新增默认单次摘要上限 `50_000` 字符：
  - 清洗后不超过 50,000 字符，先发送一次完整转录。
  - 超过 50,000 字符，直接走现有 24,000 字符分块和归并流程。
  - 24,000-50,000 字符的单次请求抛错、返回空字符串或 JSON 无法解析时，再使用现有 24,000 字符分块流程。
  - 不超过 24,000 字符的请求失败时不重复发送相同内容，直接返回失败状态。
- 单次摘要、分块摘要和归并摘要都使用 4,096 tokens 与 60 秒 QCLOUD 超时。
- 保留现有 provider fallback 顺序，不增加 `stopAfterQCloudFailure` 或新的路由模式。
- 保留现有 JSON 解析逻辑，不增加新的 schema 校验框架。

同步修改摘要 prompt：

- 保留 system prompt 中现有摘要规则和 JSON schema，避免重构现有 prompt 生成器。
- 在 user message 的会议内容之后再次追加：
  1. 明确的转录结束分隔符。
  2. “只返回合法 JSON，不要 markdown”。
  3. 与当前模式对应的完整 JSON schema。
- JSON schema 必须是 user message 的最后内容，后面不得再追加转录、参考资料或说明。
- 单次摘要、分块摘要和归并摘要都遵循相同顺序。

只增加一个最小失败状态：

```ts
generationStatus?: 'success' | 'failed';
```

- 摘要解析成功时写入 `success`。
- 单次及必要的分块回退都失败时，返回现有空摘要结构并写入 `failed`。
- 在现有 `detailedSummary` JSON 中保存该字段，不增加数据库列或迁移。
- `MeetingDetails` 在 `failed` 时显示：“云端摘要暂时生成失败，会议转录已保存。”

### 4. 摘要增强

修改 `electron/services/post-call/PostCallLlmEnhancements.ts`：

- QCLOUD 输出预算改为 2,048 tokens。
- 保留现有异常捕获和空增强 fallback。
- 不增加增强状态、额外持久化或重试机制。

### 5. 智能卡片

修改 `electron/IntelligenceEngine.ts`：

- `intent-classification` 的 `perProviderTimeoutMs` 从 2,500 改为 6,000。
- `dynamic-action-semantic-gate` 的 `perProviderTimeoutMs` 从 2,500 改为 6,000。
- 保留 `maxRotations: 1`、两阶段调用顺序、候选动作、风险策略和本地判断逻辑。
- 不合并两次云端判断，不增加快速模型 fallback。
- 复用现有 `DynamicActionBar` 的“云端服务繁忙，智能卡片暂不可用”提示，不新增 toast、IPC 或遥测体系。

## 明确不做

- 不修改 provider router 或跨 provider fallback 顺序。
- 不增加 `stopAfterQCloudFailure`。
- 不增加摘要任务队列、自动重试或手动重试 IPC。
- 不增加数据库迁移。
- 不增加摘要失败原因枚举或增强状态。
- 不重写摘要分块器或 prompt 框架。
- 不修复本地意图分类器 code 1；该问题独立处理。
- 不修改普通聊天、STT、PPTX、Embedding 或数据范围策略。

## 文件范围

- `electron/llm/QCloudLlmConstants.ts`
- `electron/LLMHelper.ts`
- `electron/MeetingPersistence.ts`
- `electron/services/post-call/PostCallSummaryGenerator.ts`
- `electron/services/post-call/PostCallLlmEnhancements.ts`
- `electron/IntelligenceEngine.ts`
- `electron/db/DatabaseManager.ts`
- `src/components/MeetingDetails.tsx`
- 对应类型和测试文件

## 验收测试

- 标题 QCLOUD 请求使用 `lite32k`、64 tokens 和 60 秒超时。
- 核心摘要 QCLOUD 请求使用 `lite32k`、4,096 tokens 和 60 秒超时。
- 摘要增强 QCLOUD 请求使用 2,048 tokens。
- 清洗后恰好 50,000 字符只执行一次核心摘要请求。
- 超过 50,000 字符直接执行现有分块流程。
- 24,000-50,000 字符单次请求抛错、返回空字符串或 JSON 无法解析时进入分块流程。
- 不超过 24,000 字符失败时不重复相同请求。
- JSON schema 位于 user message 最末尾。
- 摘要最终失败时保存 `generationStatus: 'failed'`，会议详情显示明确提示。
- 标题失败不影响摘要；摘要失败不覆盖已有标题。
- 两个智能卡片结构化请求均使用 6 秒超时和 `maxRotations: 1`。
- 云端故障与正常“没有匹配动作”继续显示不同状态。

真实 API 只保留已经完成的 5 万字符单次摘要基线；超时、空响应和无效 JSON 使用 mock 测试，不依赖真实服务制造故障。

运行：

```bash
npm run build:electron
npm run typecheck:electron
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/PostCallSummaryGenerator.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/PostCallLlmEnhancements.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/QCloudLlmConstants.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/QCloudTimeoutRootCause.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/__tests__/MeetingPersistence.test.mjs
```
