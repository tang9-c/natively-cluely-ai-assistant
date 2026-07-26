# LLM Post-Call Enhancements Design

## Goal

会后摘要页中的正文摘要、“辅导”和“跟进草稿”必须由 LLM 基于会议转录、正文摘要和模式上下文生成，不再由关键词正则直接产出用户可见结论。

正文摘要必须覆盖完整转录。长会议不能再只截取前 50,000 字符生成摘要，而应通过全文分段汇总和最终归并生成整体摘要，避免后半场关键信息被遗漏。

本设计解决的问题是：FDE 等模式下，规则扫到“追溯”“顺便”“权限”“质量”等词后，会生成看似确定的英文辅导结论，导致用户认为摘要和转录对不上。修复后，关键词规则不能直接生成用户可见的 coaching insight 或 follow-up draft；如果 LLM 找不到明确证据，就不生成对应增强项。

FDE 模式的摘要页还必须显式体现行动项和决策项。不能把“下一步”一概当作行动项；只有会议中明确出现执行动作、责任方、交付物、验证动作或时间边界时，才进入行动项。仅表达意向、开放问题、待确认方向或泛泛的“后面看看”，应进入待确认/开放问题，而不是行动项。

## Current Behavior

当前会后保存链路在 `MeetingPersistence.processAndSaveMeeting()` 中先生成正文摘要，再调用 `buildPostCallEnhancements()` 把增强字段合并进 `summaryData`。

正文摘要当前调用 `generateMeetingSummary()` 时只传入 `data.context.substring(0, 50000)`。这会导致长会议只基于前半段或前若干段内容生成摘要，后续讨论、行动项、风险、决策和模式关键信息可能完全不进入正文摘要。

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

### 2. Full-Transcript Summary Generation

正文摘要生成必须从单次截断调用改为全文分段汇总：

1. 将完整转录按 token / 字符预算切成稳定、有重叠的片段。
2. 对每个片段调用 LLM 生成局部结构化摘要，输出格式与当前模式摘要结构兼容。
3. 对所有局部摘要做最终归并，生成最终 `summaryData`：
   - 有模式分区时，归并到对应 `sections`。
   - 无模式分区时，归并到 `overview`、`keyPoints`、`actionItems`。
   - FDE 模式必须在最终摘要中保留行动项和决策项；如果当前 FDE 模板没有对应分区，应通过固定的 `actionItems` / `decisions` 增强字段或新增模式分区表达。
4. 每个阶段都必须要求 LLM 不编造、不解释概念、不输出转录外信息。
5. 片段汇总失败时，应记录安全元数据并尽量继续处理其他片段；如果最终无法形成有效摘要，才回退为空摘要结构。

长会议正文摘要不能再使用 `data.context.substring(0, 50000)` 作为唯一输入。允许在单个片段内部截断以满足模型上下文限制，但完整会议必须通过多片段覆盖。

### 3. FDE Action And Decision Semantics

FDE 模式摘要页必须区分以下信息类型：

- 行动项：明确需要有人执行的事项，例如准备验证材料、确认接口权限、提供测试数据、安排 POC、输出验收标准。优先包含责任方、交付物、时间点或验证方式；缺少其中部分字段时仍可记录，但必须是可执行动作。
- 决策项：会议中已经确认、选定、批准或达成一致的结论，例如范围边界、第一阶段接入系统、只读/写回策略、部署环境、验证口径。
- 待确认/开放问题：尚未变成行动项的下一步，例如“后续再看”“可能需要确认”“客户表达了担心但没有明确由谁处理”。这类内容不能被塞进行动项。

正文摘要、分段摘要归并和 LLM 增强都必须遵守这三个分类。特别是 `followUpDraft` 可以引用待确认事项，但不能把没有执行主体或交付边界的“下一步”伪装成行动项。

### 4. LLM Contract

LLM 必须遵守以下输出契约：

- 所有用户可见内容使用简体中文。
- 每条 `coachingInsight` 必须有明确证据句；没有证据就不生成。
- 不要把关键词命中当结论，例如不能因为出现“追溯”就自动输出“审计/质量记录风险”。
- 不要生成英文标题，例如 `Permission, audit...`。
- FDE 模式必须区分行动项、决策项和待确认事项；不要把泛泛的“下一步”自动归为行动项。
- `followUpDraft` 必须基于会议中明确讨论的下一步、待确认事项或交付计划。
- 如果会议没有明确跟进事项，`followUpDraft` 返回空字符串，不输出 `I will follow up if anything else is needed.` 这类空模板。
- 输出必须是可解析 JSON，不允许 markdown 代码块。

### 5. Transcript Handling

会后增强必须使用与正文摘要一致的证据范围，避免“正文摘要只看前半段、增强项扫全文”的观感错位。

实现阶段优先采用一个简单可靠的输入策略：

- 对短会议：正文摘要和增强模块都可以直接使用完整转录。
- 对长会议：正文摘要必须使用全文分段汇总；增强模块应优先使用最终正文摘要、局部片段摘要、模式分区摘要、accepted dynamic action records，以及必要的证据窗口。

增强模块不要求再次扫描全文原文，但它使用的摘要输入必须来自全文覆盖后的正文摘要/局部摘要，不能依赖只覆盖前 50,000 字符的正文摘要。

### 6. Failure And Fallback

LLM 增强失败时：

- 不阻塞会议保存。
- `coachingInsights` 返回空数组。
- `followUpDraft` 返回空字符串。
- 记录安全日志，只包含错误类型、模式、输入长度等元数据，不记录转录、prompt、证据句或用户内容。

不允许回退到旧的正则用户可见输出；否则会重新引入本次问题。

正文摘要分段汇总失败时：

- 不阻塞会议保存。
- 尽量保留已成功生成的片段摘要。
- 最终归并失败时返回空的模式分区或空的通用摘要结构。
- 记录安全日志，只包含错误类型、片段数量、输入长度、模式等元数据，不记录转录正文或 prompt。

### 7. Backward Compatibility

数据库结构不变。`detailedSummary` 仍可包含：

- `coachingInsights`
- `followUpDraft`
- accepted records
- structured action items
- FDE decisions / open questions, if added through compatible optional fields or mode sections

历史会议保持原样，不做迁移。新生成的会议使用 LLM 增强结果。

### 8. UI Behavior

`MeetingDetails` 可以继续显示“辅导”和“跟进草稿”，但内容来源变为 LLM 增强。

展示规则：

- FDE 模式摘要页应显示可识别的行动项和决策项；待确认/开放问题应与行动项分开展示，避免误导用户认为已经有人负责。
- `coachingInsights.length === 0` 时不显示“辅导”区块。
- `followUpDraft.trim() === ''` 时不显示“跟进草稿”区块。
- 所有新生成的用户可见内容应为中文。

## Non-Goals

- 不引入 embedding / RAG 参与会后增强生成。
- 不迁移历史会议数据。
- 不移除 dynamic action accepted records。
- 不修改 FDE 模式本身的实时动态动作检测。
- 不把旧正则规则作为用户可见 fallback。

## Testing Strategy

新增或更新测试覆盖：

1. FDE 转录中只出现“追溯”“顺便”等宽泛词时，不应由正则直接生成用户可见英文 coaching insight。
2. 长转录超过单次上下文预算时，正文摘要会覆盖头部、中部、尾部片段，而不是只调用一次 `substring(0, 50000)`。
3. 模式分区摘要在分段归并后仍保持模板顺序和字段结构。
4. FDE 摘要中明确的行动项和决策项会被保留并分开展示。
5. FDE 中没有责任方、交付物、验证动作或时间边界的“下一步”，不会被归入行动项。
6. LLM 返回有证据的中文 JSON 时，`coachingInsights` 和 `followUpDraft` 正确写入 `detailedSummary`。
7. LLM 返回空增强时，UI 不显示“辅导”和“跟进草稿”。
8. LLM 失败或 JSON 解析失败时，会议仍保存成功，增强字段为空。
9. `PostCallWorkflow` 的纯函数测试证明 deterministic accepted records 仍保留。
10. 源码契约测试证明 `buildFollowUpDraft()` 的空泛英文兜底不再进入新会议的用户可见路径。

## Success Criteria

- 新会后摘要页不会再因为关键词正则直接出现英文的 `Permission, audit...`、`Scope change...` 等卡片。
- 长会议正文摘要覆盖完整转录，不再只基于前 50,000 字符。
- FDE 摘要页明确区分行动项、决策项和待确认/开放问题。
- FDE 模式会议仍能产生有价值的辅导建议，但每条建议必须由 LLM 给出明确中文证据。
- 没有明确下一步时，不显示空泛跟进草稿。
- 会后摘要生成失败不会影响会议保存。
- 相关单测、Electron 类型检查和目标会后摘要测试通过。
