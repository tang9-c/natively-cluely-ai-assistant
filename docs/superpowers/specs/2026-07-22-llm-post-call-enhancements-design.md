# LLM Post-Call Enhancements Design

## Goal

会后摘要页中的“辅导”和“跟进草稿”必须由 LLM 基于会议转录、正文摘要和模式上下文生成，不再由关键词正则直接产出用户可见结论。

本设计解决的问题是：FDE 等模式下，规则扫到“追溯”“顺便”“权限”“质量”等词后，会生成看似确定的英文辅导结论，导致用户认为摘要和转录对不上。修复后，关键词规则不能直接生成用户可见的 coaching insight 或 follow-up draft；如果 LLM 找不到明确证据，就不生成对应增强项。

## Current Behavior

当前会后保存链路在 `MeetingPersistence.processAndSaveMeeting()` 中先生成正文摘要，再调用 `buildPostCallEnhancements()` 把增强字段合并进 `summaryData`。

`buildPostCallEnhancements()` 当前同步返回：

- `actionItemsStructured`
- accepted dynamic action records
- `followUpDraft`
- `coachingInsights`

其中 `followUpDraft` 由 `buildFollowUpDraft()` 模板拼接生成，没提取到有效事项时会输出空泛兜底句。

`coachingInsights` 由 `generateCoachingInsights()` 基于模式和正则关键词生成。FDE 模式下，`追溯`、`顺便`、`权限`、`质量` 等词可能触发用户可见的英文信号卡片。

## Proposed Design

### 1. Split Deterministic Records From LLM-Generated Enhancements

保留 `buildPostCallEnhancements()` 中确定性的结构化记录能力，例如：

- action item extraction
- accepted team decisions / blockers
- accepted sales capability records
- accepted FDE records
- accepted recruiting records

但它不再直接生成用户可见的 `coachingInsights` 和 `followUpDraft`。

新增异步 LLM 步骤，例如 `generatePostCallLlmEnhancements()`，由 `MeetingPersistence` 在正文摘要生成之后调用。

输入：

- `transcript`
- `summaryData`
- `modeTemplateType`
- accepted dynamic action records
- optional deterministic action items

输出：

```ts
interface LlmPostCallEnhancements {
  coachingInsights: Array<{
    type: string;
    title: string;
    detail: string;
    severity: 'info' | 'opportunity' | 'warning';
    evidence?: string;
  }>;
  followUpDraft: string;
}
```

### 2. LLM Contract

LLM 必须遵守以下输出契约：

- 所有用户可见内容使用简体中文。
- 每条 `coachingInsight` 必须有明确证据句；没有证据就不生成。
- 不要把关键词命中当结论，例如不能因为出现“追溯”就自动输出“审计/质量记录风险”。
- 不要生成英文标题，例如 `Permission, audit...`。
- `followUpDraft` 必须基于会议中明确讨论的下一步、待确认事项或交付计划。
- 如果会议没有明确跟进事项，`followUpDraft` 返回空字符串，不输出 `I will follow up if anything else is needed.` 这类空模板。
- 输出必须是可解析 JSON，不允许 markdown 代码块。

### 3. Transcript Handling

会后增强应尽量使用与正文摘要一致的证据范围，避免“正文摘要只看前半段、增强项扫全文”的观感错位。

实现阶段优先采用一个简单可靠的输入策略：

- 对短会议：直接使用完整转录。
- 对长会议：传入正文摘要、模式分区摘要、accepted dynamic action records，以及从转录头部/中部/尾部采样的证据窗口。

本 spec 不要求一次性实现全文分段 map-reduce 摘要，但设计必须避免只由关键词规则扫全文后直接输出结论。

### 4. Failure And Fallback

LLM 增强失败时：

- 不阻塞会议保存。
- `coachingInsights` 返回空数组。
- `followUpDraft` 返回空字符串。
- 记录安全日志，只包含错误类型、模式、输入长度等元数据，不记录转录、prompt、证据句或用户内容。

不允许回退到旧的正则用户可见输出；否则会重新引入本次问题。

### 5. Backward Compatibility

数据库结构不变。`detailedSummary` 仍可包含：

- `coachingInsights`
- `followUpDraft`
- accepted records
- structured action items

历史会议保持原样，不做迁移。新生成的会议使用 LLM 增强结果。

### 6. UI Behavior

`MeetingDetails` 可以继续显示“辅导”和“跟进草稿”，但内容来源变为 LLM 增强。

展示规则：

- `coachingInsights.length === 0` 时不显示“辅导”区块。
- `followUpDraft.trim() === ''` 时不显示“跟进草稿”区块。
- 所有新生成的用户可见内容应为中文。

## Non-Goals

- 不改正文摘要的整体生成策略。
- 不引入 embedding / RAG 参与会后增强生成。
- 不迁移历史会议数据。
- 不移除 dynamic action accepted records。
- 不修改 FDE 模式本身的实时动态动作检测。
- 不把旧正则规则作为用户可见 fallback。

## Testing Strategy

新增或更新测试覆盖：

1. FDE 转录中只出现“追溯”“顺便”等宽泛词时，不应由正则直接生成用户可见英文 coaching insight。
2. LLM 返回有证据的中文 JSON 时，`coachingInsights` 和 `followUpDraft` 正确写入 `detailedSummary`。
3. LLM 返回空增强时，UI 不显示“辅导”和“跟进草稿”。
4. LLM 失败或 JSON 解析失败时，会议仍保存成功，增强字段为空。
5. `PostCallWorkflow` 的纯函数测试证明 deterministic accepted records 仍保留。
6. 源码契约测试证明 `buildFollowUpDraft()` 的空泛英文兜底不再进入新会议的用户可见路径。

## Success Criteria

- 新会后摘要页不会再因为关键词正则直接出现英文的 `Permission, audit...`、`Scope change...` 等卡片。
- FDE 模式会议仍能产生有价值的辅导建议，但每条建议必须由 LLM 给出明确中文证据。
- 没有明确下一步时，不显示空泛跟进草稿。
- 会后摘要生成失败不会影响会议保存。
- 相关单测、Electron 类型检查和目标会后摘要测试通过。
