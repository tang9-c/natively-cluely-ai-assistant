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
4. 当前会议尚无 chunks 时，从该会议的完整转录按需生成文本 chunks。
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
  │ meetingId + query
  ▼
rag:query-meeting
  │
  ▼
RAGManager.queryMeeting()
  │
  ├─ 验证会议存在
  ├─ 读取当前会议转录
  ├─ 确保当前会议文本 chunks 存在
  ├─ 当前会议关键词检索（始终执行）
  ├─ 当前会议向量检索（Embedding 可用时执行）
  └─ 合并、过滤并验证 meetingId
        │
        ├─ 无证据：返回固定中文结果，不调用 LLM
        └─ 有证据：只把当前会议证据交给 LLM
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

会议搜索只监听 `rag:stream-*` 事件。事件处理前必须检查：

```ts
data.meetingId === meetingContext.id && data.global !== true
```

其他会议或全局搜索事件必须被忽略。

### 2. IPC 不再返回通用聊天 fallback

`rag:query-meeting` 不再以 `RAGManager.isReady()` 或“会议存在 Embedding”作为允许查询的前置条件。

IPC 返回状态限定为：

```ts
type MeetingSearchResult =
  | { status: 'success' }
  | { status: 'no_match' }
  | { status: 'meeting_not_found'; error: string }
  | { status: 'transcript_unavailable'; error: string }
  | { status: 'scope_denied'; error: string }
  | { status: 'llm_unavailable'; error: string }
  | { status: 'query_failed'; error: string };
```

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

如果 `transcript` 数据范围被拒绝，返回 `scope_denied`，不得清空上下文后继续调用 LLM。

### 4. 按需确保当前会议文本 chunks

为 `VectorStore` 增加：

```ts
hasChunks(meetingId: string): boolean
```

`RAGManager.queryMeeting()` 在检索前执行：

1. 查询 `meetings WHERE id = ?`；
2. 如果没有会议，返回 `meeting_not_found`；
3. 如果已有当前会议 chunks，直接检索；
4. 如果没有 chunks，从 `transcripts WHERE meeting_id = ? ORDER BY timestamp_ms ASC` 读取完整转录；
5. 如果转录为空，返回 `transcript_unavailable`；
6. 使用现有 `SemanticChunker` 生成文本 chunks 并保存；
7. Embedding 可用时将新 chunks 加入 Embedding 队列；
8. Embedding 不可用时保留文本 chunks，并立即进行关键词检索。

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

对于“总结”“行动项”“决定”等意图，允许加入当前会议结构化摘要中对应的字段作为当前会议证据，但不得读取其他数据源。

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

有证据时继续使用 `RAGManager.queryMeeting()` 内的会议 RAG prompt。

传给 LLM 的内容只能包括：

- 当前会议证据；
- 用户问题；
- 当前会议 RAG 系统规则。

该调用不得经过 `gemini-chat-stream`，从而绕开上传材料、模式上下文、用户画像和普通聊天上下文注入。

LLM 输出必须：

- 使用简体中文；
- 只根据会议证据回答；
- 不补充证据中不存在的事实；
- 不提及 RAG、Embedding、chunks 或技术降级。

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

不得把技术错误、provider 名称、绝对路径、查询文本或会议内容写入用户界面和日志。

## 测试设计

### 单元测试

1. `searchLexical()` 收到并应用指定 `meetingId`。
2. `searchSimilar()` 收到并应用相同 `meetingId`。
3. Embedding provider 不可用时仍返回当前会议关键词结果。
4. 查询向量生成失败时不会丢弃关键词结果。
5. 合并阶段会删除其他会议的候选。
6. 当前会议没有 chunks 时，只从该会议转录生成 chunks。
7. 当前会议没有转录时返回 `transcript_unavailable`。
8. 无证据时返回 `no_match`，且 LLM 调用次数为零。
9. `transcript` 数据范围被拒绝时返回 `scope_denied`，且 LLM 调用次数为零。
10. 有证据时 LLM 只收到当前会议证据。

### IPC 和 contract 测试

1. `rag:query-meeting` 不调用 `resolveUploadedMaterialChatContext()`。
2. `rag:query-meeting` 不调用 `queryGlobal()`。
3. `MeetingChatOverlay` 不引用 `streamGeminiChat`。
4. `MeetingChatOverlay` 不包含 `slice(-20)`。
5. renderer 只接受匹配 `meetingId` 且非 global 的流事件。
6. IPC、preload 和 renderer 使用一致的 `MeetingSearchResult` 类型。

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
3. Embedding 不可用时仍可搜索当前会议中的明确关键词。
4. 无当前会议证据时不调用 LLM。
5. 上传材料、模式参考资料、用户画像和其他会议永远不会进入当前会议搜索的 LLM 输入。
6. 全局搜索功能保持原有独立入口和行为。
7. 所有用户可见结果使用简体中文。

## 非目标

- 不改变“搜索所有会议”的产品语义。
- 不修改上传材料在普通聊天中的行为。
- 不修改模式参考资料在实时辅助中的行为。
- 不重构 Provider Router。
- 不调整全局搜索排序。
- 不新增跨会议引用或引用 UI。
- 不允许以任何普通聊天路径代替当前会议搜索。
