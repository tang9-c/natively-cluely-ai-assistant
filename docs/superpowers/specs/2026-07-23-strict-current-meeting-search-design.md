# 严格限定当前会议的搜索设计

## 背景

会议详情页的入口文案是“搜索本次会议”和“询问本次会议”。用户对这个入口的合理预期是：回答只能依据当前打开会议的数据。

现有主 RAG 路径会把 `meetingId` 传入检索器，向量检索和关键词检索都限定 `meeting_id = ?`。但在 RAG 未初始化、当前会议没有 Embedding、查询向量生成失败或检索未命中时，renderer 会降级到通用 `gemini-chat-stream`。

该通用聊天链路存在以下范围偏移：

- 只携带会议摘要、要点、行动项和最后 20 条转录，不是当前会议全文；
- 可能追加上传材料；
- 可能追加当前模式提示词和模式参考资料；
- 可能追加用户画像、自定义备注；
- 可能因数据范围策略把整个会议上下文清空；
- 最终仍调用 LLM，因此无会议证据时也可能生成看似合理的回答。

这使“搜索本次会议”在部分运行条件下变成普通聊天，而不是严格的当前会议检索。

## 目标

建立一条严格限定当前会议的数据链路：

1. 所有检索都必须携带并验证当前 `meetingId`。
2. Embedding 可用时执行当前会议语义检索和关键词检索。
3. Embedding 不可用或查询向量生成失败时，继续执行当前会议关键词检索。
4. 当前会议索引缺失、不完整或与完整转录不一致时，从该会议的完整转录按需原子重建文本 chunks。
5. 只有找到当前会议证据后才允许调用 LLM。
6. 没有找到证据时返回确定性的中文提示，不调用 LLM。
7. 不得进入通用聊天链路，不得读取任何当前会议以外的上下文。

## 产品语义

“搜索本次会议”是一个严格的数据范围承诺，不是普通聊天的视觉变体。

### 允许的数据源

- 当前会议标题；
- 当前会议结构化摘要；
- 当前会议完整转录；
- 由当前会议完整转录生成的 chunks；
- 当前会议 chunks 的 Embedding。

所有记录必须满足 `source.meetingId === requestedMeetingId`。

### 禁止的数据源

- 其他会议；
- 全局会议检索结果；
- 上传材料和知识库材料；
- 当前模式参考文件和自定义模式上下文；
- 用户画像、Persona 和自定义备注；
- 当前实时会话的滚动上下文；
- 普通聊天历史；
- Knowledge Mode 返回结果；
- 模型自身记忆或未经会议证据支持的推断。

## 方案选择

采用严格的当前会议混合检索：

- 关键词检索是始终可用的基础能力；
- 向量检索是 Embedding 可用时的召回增强；
- 两者只能搜索当前 `meetingId`；
- Embedding 故障属于语义能力降级，不得把功能切换为通用聊天；
- 没有当前会议证据时不生成回答。

不采用以下方案：

- 不采用“RAG 不可用就完全禁用搜索”，因为当前会议文本仍可进行关键词检索；
- 不采用“每次把完整转录直接发送给 LLM”，因为长会议会带来不必要的上下文、延迟和成本；
- 不采用任何通用聊天 fallback。

## 架构

```text
MeetingChatOverlay
  │ meetingId + query + requestId
  ▼
rag:query-meeting
  │
  ▼
RAGManager.prepareMeetingQuery()
  │
  ├─ 验证会议存在
  ├─ 读取当前会议转录
  ├─ 验证完整转录指纹与索引状态
  ├─ 必要时原子重建完整会议 chunks
  ├─ 当前会议关键词检索（始终执行）
  ├─ 当前会议向量检索（Embedding 可用时执行）
  └─ 合并、过滤并验证 meetingId
        │
        ├─ 无证据：返回结构化状态，不调用 LLM
        └─ 有证据：RAGManager.streamMeetingAnswer()
                    只把当前会议证据交给 LLM
```

## 详细设计

### 1. Renderer 只保留会议 RAG 调用

`MeetingChatOverlay` 不再构造普通聊天上下文，也不再调用 `streamGeminiChat()`。

删除：

- `buildContextString()`；
- `meetingContext.transcript.slice(-20)`；
- `buildMeetingFallbackSystemPrompt()`；
- Gemini fallback 的 token、done 和 error listeners；
- `result.fallback` 对普通聊天的分支处理。

每次提交使用现有消息 ID 生成器创建唯一 `requestId`。会议搜索只监听 `rag:stream-*` 事件，事件处理前必须同时检查：

```ts
data.requestId === activeRequestId &&
data.meetingId === meetingContext.id &&
data.global !== true
```

不匹配当前 `requestId`、其他会议或全局搜索的事件必须被忽略。关闭弹窗时必须调用 `ragCancelQuery({ meetingId, requestId })`，并清空当前 `activeRequestId`。

### 2. IPC 不再返回通用聊天 fallback

`rag:query-meeting` 不再以 `RAGManager.isReady()` 或“会议存在 Embedding”作为允许查询的前置条件。

renderer 调用参数和 IPC 返回状态限定为：

```ts
interface MeetingSearchRequest {
  meetingId: string;
  query: string;
  requestId: string;
}

type MeetingSearchResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'no_match'; message: string }
  | { status: 'meeting_not_found'; message: string }
  | { status: 'transcript_unavailable'; message: string }
  | { status: 'scope_denied'; message: string }
  | { status: 'llm_unavailable'; message: string }
  | { status: 'query_failed'; message: string };

interface MeetingSearchStreamEvent {
  requestId: string;
  meetingId: string;
  global?: false;
}

type MeetingSearchChunkEvent = MeetingSearchStreamEvent & { chunk: string };
type MeetingSearchCompleteEvent = MeetingSearchStreamEvent;
type MeetingSearchErrorEvent = MeetingSearchStreamEvent & {
  status: Exclude<MeetingSearchResult['status'], 'success' | 'cancelled' | 'no_match'>;
  message: string;
};
```

只有准备结果为 `ready` 时才允许开始 token 流。准备阶段产生的 `no_match` 和错误状态直接通过 IPC invoke 返回，renderer 使用返回的 `message` 替换空的 assistant placeholder，不等待流事件。流式生成开始后的 provider 错误必须发送 `MeetingSearchErrorEvent`，丢弃部分回答，并让 IPC invoke 返回相同的 `query_failed` 或 `llm_unavailable` 状态。

请求被关闭弹窗或新请求中止时返回 `{ status: 'cancelled' }`，不发送 complete/error 事件，也不显示错误。renderer 在处理 IPC invoke 的最终返回值前仍须比较 `requestId === activeRequestId`；旧请求的返回值和事件都必须被忽略。

内部接口拆分为：

```ts
type MeetingQueryPreparation =
  | {
      status: 'ready';
      meetingId: string;
      query: string;
      formattedContext: string;
      intent: QueryIntent;
    }
  | Exclude<MeetingSearchResult, { status: 'success' }>;

RAGManager.prepareMeetingQuery(
  meetingId: string,
  query: string,
): Promise<MeetingQueryPreparation>;

RAGManager.streamMeetingAnswer(
  prepared: Extract<MeetingQueryPreparation, { status: 'ready' }>,
  abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown>;
```

IPC 必须先调用 `prepareMeetingQuery()`。只有返回 `ready` 时才调用 `streamMeetingAnswer()`、发送带 `requestId` 的 token/done/error 事件并最终返回 `{ status: 'success' }`。其他状态直接返回。

活动请求按 `${event.sender.id}:${meetingId}` 管理。新请求开始前必须中止同一 renderer、同一会议的旧请求；不同 renderer 互不取消。内部记录同时保存 `requestId` 和 `AbortController`，finally 只允许删除仍与自身 `requestId` 匹配的记录。

该 handler 不得调用：

- `gemini-chat-stream`；
- `resolveUploadedMaterialChatContext()`；
- `ragManager.queryGlobal()`；
- `KnowledgeOrchestrator`；
- `ModesManager` 的上下文检索。

### 3. 分离文本检索和语义检索可用性

当前 `RAGManager.isReady()` 同时依赖 Embedding provider 和 LLM，这不适合作为当前会议文本搜索的总开关。

会议搜索分别判断：

- 会议数据是否存在；
- 当前会议转录或 chunks 是否存在；
- Embedding provider 是否可用；
- LLM 是否可用；
- `transcript` 数据范围是否允许发送给当前 provider。

Embedding 不可用时只跳过向量检索。它不能阻止关键词检索。

IPC 在读取会议内容前通过 `SettingsManager.get('providerDataScopes')` 和 `getDeniedDataScopes(['transcript'], policy)` 执行范围预检。如果 `transcript` 被拒绝，立即返回 `scope_denied`，不得读取转录、执行检索或调用 LLM。会议 RAG 调用仍必须把 `transcript` 声明为 outbound data scope，禁止采用“清空 context 后继续请求”的行为。

证据组装完成后先判断是否为空：为空返回 `no_match`。只有证据非空时才检查 `llmHelper`；未初始化则返回 `llm_unavailable`，存在时才返回 `ready`。

### 4. 按需确保当前会议文本 chunks

### 4.1 完整索引状态

数据库迁移 `v30 → v31` 为 `meetings` 增加：

```ts
rag_transcript_hash TEXT
rag_index_state TEXT NOT NULL DEFAULT 'missing'
```

`rag_index_state` 只允许应用层写入以下值：

- `missing`：没有可证明完整的索引；
- `building`：正在基于完整转录重建；
- `complete`：chunks 与 `rag_transcript_hash` 对应；
- `failed`：最近一次完整重建失败。

重建开始前把状态更新为 `building`；原子替换成功后在事务内更新为 `complete`；预处理、分块或事务失败后更新为 `failed`。应用启动或下次查询看到遗留的 `building` 时按未完成索引处理并重新构建。这里的 `complete` 只表示文本 chunks 完整且与转录 hash 一致，不表示 Embedding 已完成。

完整转录指纹使用 SHA-256，对按 `timestamp_ms ASC, id ASC` 排序后的记录逐条加入以下规范字段：

```text
speaker + "\u0000" + timestamp_ms + "\u0000" + content + "\u0001"
```

不得把指纹原文写入日志。实时 `LiveRAGIndexer` 写入的增量 chunks 不得把 `rag_index_state` 标记为 `complete`。

为 `VectorStore` 增加：

```ts
getMeetingChunkState(meetingId: string): {
  chunkCount: number;
  transcriptHash: string | null;
  indexState: 'missing' | 'building' | 'complete' | 'failed';
};

replaceMeetingChunksAtomically(
  meetingId: string,
  chunks: Chunk[],
  transcriptHash: string,
): void;
```

`replaceMeetingChunksAtomically()` 必须在同一数据库事务中：

1. 删除该会议旧 chunks 对应的所有 vec 表记录；
2. 删除该会议旧 `embedding_queue` 记录；
3. 删除该会议旧 chunks；
4. 插入新 chunks；
5. 更新 `rag_transcript_hash` 和 `rag_index_state = 'complete'`。

任何步骤失败都回滚，不允许留下半套索引。

### 4.2 按需确保完整索引

`RAGManager` 使用 `Map<string, Promise<void>>` 保存 `ensureMeetingIndexInFlight`。同一会议的并发查询必须复用同一个重建 Promise；完成或失败后在 `finally` 中清理。

`prepareMeetingQuery()` 在检索前执行：

1. 查询 `meetings WHERE id = ?`；
2. 如果没有会议，返回 `meeting_not_found`；
3. 从 `transcripts WHERE meeting_id = ? ORDER BY timestamp_ms ASC, id ASC` 读取完整转录；
4. 如果转录为空，返回 `transcript_unavailable`；
5. 计算当前完整转录指纹；
6. 读取 `getMeetingChunkState(meetingId)`；
7. 只有 `indexState === 'complete'`、`chunkCount > 0` 且已存 hash 与当前指纹相等时才直接检索；
8. 其他情况都在会议级锁内重新读取状态，仍不匹配时使用现有 `preprocessTranscript()` 和 `chunkTranscript()` 生成完整 chunks；
9. 调用 `replaceMeetingChunksAtomically()` 完成替换；
10. Embedding 可用时将新 chunks 加入 Embedding 队列；
11. Embedding 不可用时保留文本 chunks，并立即执行关键词检索。

按需生成只允许处理请求中的 `meetingId`，不得扫描或重建其他会议。

### 5. 关键词检索始终执行

`RAGRetriever.retrieve(query, { meetingId })` 调整为：

1. 先执行 `searchLexical(retrievalQuery, { meetingId })`；
2. Embedding provider 可用时尝试生成查询向量；
3. 查询向量成功时执行 `searchSimilar(..., { meetingId })`；
4. 查询向量失败时记录不含用户文本的安全诊断，并继续使用关键词结果；
5. 合并关键词和向量候选；
6. 丢弃任何 `chunk.meetingId !== requestedMeetingId` 的候选；
7. 排序、裁剪并组装证据。

不得因为查询向量失败而提前返回空结果。

### 5.1 意图到证据源的确定映射

`RAGRetriever.detectIntent()` 的结果必须按下表确定证据源，不允许由实现者自行选择：

| intent | 必须加入的当前会议证据 | 补充检索 |
|---|---|---|
| `summary` | `detailedSummary.overview`、`keyPoints`；字段为空时按时间均匀抽取完整会议 chunks | 当前会议 hybrid/lexical chunks |
| `action_items` | `detailedSummary.actionItems`；字段为空时使用行动意图扩展词检索 | 当前会议 hybrid/lexical chunks |
| `decision_recall` | `detailedSummary.decisions`；字段为空时使用决定意图扩展词检索 | 当前会议 hybrid/lexical chunks |
| `speaker_lookup` | 无结构化摘要注入 | 当前会议 hybrid/lexical chunks，并保留 speaker 标签 |
| `open_question` | 无结构化摘要注入 | 当前会议 hybrid/lexical chunks |

行动意图扩展词至少包括：`行动项`、`下一步`、`跟进`、`负责`、`截止`、`action item`、`next step`、`follow up`。决定意图扩展词至少包括：`决定`、`确定`、`结论`、`同意`、`decision`、`agreed`。

结构化摘要字段只从请求中的当前会议记录读取，并作为带 `meetingId` 的当前会议证据参与统一的 1500-token 预算。`summary` 在 overview 和 key points 均为空时，必须按会议时间轴均匀抽取 chunks，而不是只取开头、结尾或最新内容。

### 6. 无证据时不调用 LLM

当合并后的当前会议证据为空时：

- 不调用 `LLMHelper`；
- 向 renderer 发送确定性的中文结果；
- 返回 `status: 'no_match'`。

用户可见文案：

```text
本次会议中没有找到与“{query}”相关的内容。
```

对用户问题进行 UI 展示时沿用现有转义机制，不把问题写入日志。

### 7. 有证据时使用隔离的 LLM 路径

有证据时由 `RAGManager.streamMeetingAnswer()` 使用现有会议 RAG prompt。

传给 LLM 的内容只能包括：

- 当前会议证据；
- 用户问题；
- 当前会议 RAG 系统规则。

该调用不得经过 `gemini-chat-stream`，从而绕开上传材料、模式上下文、用户画像和普通聊天上下文注入。

数据源隔离是代码层硬保证：LLM 输入中不得出现当前会议以外的内容。回答忠实度属于提示词级约束，本次不引入第二个 LLM 或规则引擎对生成文本做事实判定。

会议 RAG prompt 必须要求模型：

- 使用简体中文；
- 只根据会议证据回答；
- 不补充证据中不存在的事实；
- 不提及 RAG、Embedding、chunks 或技术降级。

验收只承诺并验证以下两点：

1. LLM 收到的事实性上下文全部来自当前会议；
2. prompt 明确禁止使用模型记忆和补充无证据事实。

不把“模型在所有情况下绝不产生幻觉”作为可由本次实现硬性证明的成功标准。

### 8. 错误处理

固定用户可见文案：

| 状态 | 文案 |
|---|---|
| `no_match` | `本次会议中没有找到与“{query}”相关的内容。` |
| `meeting_not_found` | `无法找到本次会议。` |
| `transcript_unavailable` | `本次会议没有可供搜索的转录内容。` |
| `scope_denied` | `当前隐私设置不允许使用会议转录进行搜索。` |
| `llm_unavailable` | `会议内容已找到，但当前无法生成回答，请稍后重试。` |
| `query_failed` | `本次会议搜索暂时不可用，请稍后重试。` |

`cancelled` 不产生用户可见文案。

不得把技术错误、provider 名称、绝对路径、查询文本或会议内容写入用户界面和日志。

如果 LLM 在已经发送部分 token 后失败，renderer 必须丢弃该请求的全部部分回答，并显示对应的固定中文错误；不得把部分回答保留为成功内容。错误事件必须携带原 `requestId`，旧请求错误不得影响新请求。

## 兼容性与升级

- `v31` 是只增加列的迁移，不删除或改写既有会议、转录和 chunks。
- 既有会议迁移后默认 `rag_index_state = 'missing'`，首次搜索该会议时按需建立完整索引；不得在升级启动时批量重建所有会议。
- 新版本回退到旧版本时，旧版本忽略新增列；不要求执行降级迁移。
- 如果 `v31` 迁移失败，当前会议搜索返回 `query_failed`，不得删除旧 chunks，也不得进入普通聊天。
- 本次不增加 feature flag；行为只替换会议详情页的“搜索本次会议”入口，不改变全局搜索入口。

## 测试设计

### 单元测试

1. `searchLexical()` 收到并应用指定 `meetingId`。
2. `searchSimilar()` 收到并应用相同 `meetingId`。
3. Embedding provider 不可用时仍返回当前会议关键词结果。
4. 查询向量生成失败时不会丢弃关键词结果。
5. 合并阶段会删除其他会议的候选。
6. 当前会议没有 chunks 时，只从该会议完整转录生成 chunks。
7. 只有部分实时 chunks、索引状态不是 `complete` 或转录 hash 不匹配时会原子重建完整 chunks。
8. 转录 hash 相同且索引为 `complete` 时不会重复重建。
9. 同一会议两个并发查询只执行一次重建，不产生重复 chunks。
10. 原子替换任一步失败时旧索引保持完整，状态不会错误标记为 `complete`。
11. 当前会议没有转录时返回 `transcript_unavailable`。
12. 无证据时返回 `no_match`，且 LLM 调用次数为零。
13. `transcript` 数据范围被拒绝时，在读取转录前返回 `scope_denied`，且检索和 LLM 调用次数均为零。
14. 有证据时 LLM 只收到当前会议证据。
15. `summary` 必须使用 overview、key points 或均匀抽取的完整会议 chunks。
16. `action_items` 必须使用 actionItems 或行动意图扩展检索。
17. `decision_recall` 必须使用 decisions 或决定意图扩展检索。
18. 会议 RAG prompt 包含中文回答、只使用当前会议证据、禁止模型记忆和禁止补充无证据事实的约束。
19. 安全日志只允许记录状态、错误分类、chunk 数量、耗时和文本长度，不包含查询、转录、绝对路径、provider 名称或 prompt。
20. `v30 → v31` 迁移保留既有会议、转录和 chunks，并把既有会议索引状态设为 `missing`。
21. 迁移失败时不删除旧 chunks，会议搜索返回 `query_failed`。

### IPC 和 contract 测试

1. `rag:query-meeting` 不调用 `resolveUploadedMaterialChatContext()`。
2. `rag:query-meeting` 不调用 `queryGlobal()`。
3. `MeetingChatOverlay` 不引用 `streamGeminiChat`。
4. `MeetingChatOverlay` 不包含 `slice(-20)`。
5. renderer 只接受同时匹配 `requestId`、`meetingId` 且非 global 的流事件。
6. 新请求会取消同一 renderer、同一会议的旧请求；旧请求 finally 不会删除新请求记录。
7. 不同 renderer 对同一会议的请求互不取消。
8. 关闭弹窗会按 `requestId` 取消活动请求。
9. 被取消请求返回 `cancelled`，不发送 complete/error 事件且不显示错误。
10. renderer 会忽略 `requestId` 已过期的 IPC 最终返回值。
11. `no_match` 和错误状态通过 IPC 返回并正确替换 assistant placeholder，不等待 stream complete。
12. 部分流失败时会丢弃全部部分回答并显示固定中文错误。
13. IPC、preload 和 renderer 使用一致的 `MeetingSearchRequest`、`MeetingSearchResult` 和流事件类型。

### 隔离回归测试

建立两个会议：

- 会议 A 包含唯一事实“预算为 700 万”；
- 会议 B 包含唯一事实“预算为 300 万”。

对会议 A 查询预算时：

- 检索结果只能包含会议 A；
- LLM 输入不得包含会议 B；
- 上传材料、模式参考资料和用户画像即使包含“300 万”也不得进入输入；
- Embedding 不可用时仍应通过关键词检索得到“700 万”；
- 查询不存在的“天心”时必须返回确定性无匹配文案，且不调用 LLM。
- 同一会议先发起慢查询再发起新查询时，界面只能显示新 `requestId` 的 token 和完成状态。

## 验证命令

实现阶段至少执行：

```bash
rtk node --test electron/rag/__tests__/*.test.mjs
rtk node --test electron/services/__tests__/MeetingSearch*.test.mjs
rtk npm run typecheck:electron
rtk npm run build:electron
rtk npm run build
```

如果全量测试存在与本次改动无关的既有失败，必须单独列出；相关会议搜索测试必须全部通过。

## 成功标准

1. `MeetingChatOverlay` 中不存在普通聊天 fallback。
2. 当前会议搜索的所有候选都具有请求中的 `meetingId`。
3. 搜索使用的持久化 chunks 必须具有 `complete` 状态，并与当前完整转录 hash 相同。
4. Embedding 不可用时仍可搜索当前会议中的明确关键词。
5. 总结、行动项和决定问题按确定的意图映射获得当前会议证据。
6. 无当前会议证据时不调用 LLM。
7. 上传材料、模式参考资料、用户画像和其他会议永远不会进入当前会议搜索的 LLM 输入。
8. 同一会议的旧请求事件不会污染新请求。
9. 全局搜索功能保持原有独立入口和行为。
10. 所有用户可见结果使用简体中文。
11. 相关日志不包含查询、转录、prompt、绝对路径或 provider 名称。

## 非目标

- 不改变“搜索所有会议”的产品语义。
- 不修改上传材料在普通聊天中的行为。
- 不修改模式参考资料在实时辅助中的行为。
- 不重构 Provider Router。
- 不调整全局搜索排序。
- 不新增跨会议引用或引用 UI。
- 不引入第二个 LLM、规则引擎或 claim verifier 对生成答案做事实判定。
- 不允许以任何普通聊天路径代替当前会议搜索。
