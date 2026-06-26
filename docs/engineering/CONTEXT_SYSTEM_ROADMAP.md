# Natively Context System Roadmap

## North Star

会议现场 2 秒内给出能直接说出口的回答建议，并且用户知道它为什么可信。

这不是“接更多模型”，也不是“加更多工具”。核心是把当前会议、短期上下文、本地资料、历史会议、长期记忆、企业知识库和屏幕内容编排成一个稳定、可解释、可评估的上下文系统。

## Product Judgment

当前最重要的用户价值是：立刻给出能用的回答建议。

为了做到这一点，优先级不是完整 MCP 工具调用，而是上下文供给链：

1. 短期记忆和当前会议上下文。
2. 本地 RAG 与资料上传。
3. Context Orchestrator，上下文编排层。
4. 长期记忆。
5. 只读企业知识库连接器。
6. 完整 MCP 工具调用。

完整 MCP tool calling 是长期平台能力，但不是当前地基。只读知识连接器更接近当前价值，但也应该作为本地 RAG 的资料补给系统，而不是实时回答的阻塞路径。

## Context Layers

```text
实时回答请求
   |
   v
Context Orchestrator
   |
   +-- 当前会议上下文
   |   - 当前 transcript
   |   - speaker separation
   |   - screen context
   |
   +-- 短期记忆
   |   - 最近 N 轮对话
   |   - 当前问题前后的局部上下文
   |
   +-- 本地知识 RAG
   |   - 用户上传资料
   |   - 历史会议
   |   - 已缓存企业知识
   |
   +-- 长期记忆
   |   - 用户偏好
   |   - 人物/客户关系
   |   - 行为事件
   |   - 常见回答风格
   |
   +-- 企业知识连接器
       - 只读同步
       - 后台更新
       - 写入本地索引
```

实时路径必须主要依赖本地可用的上下文。远程企业知识库和 MCP 只读调用应当用于预取、同步、缓存、增量刷新，不能让会议现场的回答等待远程工具返回。

## Phase 0: Context Visibility And Quality Signals

Timeline: 1 week.

Goal: Know when the system has useful context and when it is effectively answering bare.

Deliverables:

- Record `context_used` for every generated answer:
  - current transcript;
  - short-term history;
  - uploaded-document RAG;
  - historical meetings;
  - long-term memory;
  - enterprise knowledge;
  - screen context.
- Make RAG, embedding, STT, and speaker separation status visible.
- Show clear reasons when an answer path degrades.
- Capture answer quality events:
  - shown;
  - copied;
  - accepted;
  - ignored;
  - regenerated.

Acceptance:

- Every answer can be traced to the context sources it used.
- When RAG is unavailable, the user is not misled into thinking uploaded materials were used.
- Quality events are persisted locally or otherwise available for evaluation.

## Phase 1: Local RAG And Material Upload

Timeline: 1-2 weeks.

Goal: Users can give Natively important material and reliably get it used during meetings.

Deliverables:

- Simplified material upload entry point.
- Support PDF, DOCX, Markdown, and TXT.
- Batch upload.
- Indexing states:
  - queued;
  - indexing;
  - complete;
  - failed.
- File-level delete and reindex.
- Answer source citations.
- Unified retrieval across:
  - current meeting;
  - historical meetings;
  - uploaded materials.
- Improve Doubao Embedding Endpoint configuration and fallback messaging.

Acceptance:

- Upload a product FAQ, ask a related question in a meeting, and receive an answer citing that FAQ.
- If embedding is not configured, the app shows a clear degraded state.
- File indexing failures show readable errors.
- Deleted materials are no longer cited or retrieved.

## Phase 2: Context Orchestrator

Status: First implementation plan drafted; not implemented yet.

Plan:

- Saved locally at `docs/superpowers/plans/2026-06-25-context-orchestrator.md`.
- Current plan is a phased migration plan, not a direct all-at-once rewrite.
- Key correction from review: this feature has broad impact because prompt and context assembly are currently spread across the main answer chain, legacy suggestion path, multiple LLM classes, LLM helper methods, RAG query handlers, and internal structured tasks.
- First implementation should only migrate the core real-time answer path, then classify remaining LLM paths as migrated, pending, or exempt.

Timeline: 1-2 weeks.

Goal: Stop prompt assembly from becoming scattered across modules. All context entering the LLM should pass through one selection, ranking, and trimming layer.

Deliverables:

- Add `ContextOrchestrator`.
- Inputs:
  - user question;
  - current meeting transcript;
  - recent N turns;
  - RAG hits;
  - speaker metadata;
  - screen context;
  - user preference memories.
- Outputs:
  - `selectedContext`;
  - `rejectedContext`;
  - `reason`;
  - `tokenBudget`;
  - `sourceAttribution`.
- Handle stale, conflicting, and low-confidence context.
- Default priority order:
  1. current meeting;
  2. recent N turns;
  3. user-uploaded materials;
  4. historical meetings;
  5. long-term memory;
  6. cached enterprise knowledge.

Acceptance:

- The system can explain why each context source was selected or rejected.
- Token overflows are handled predictably.
- Prompt assembly no longer happens independently in multiple unrelated modules.

## Phase 3: Long-Term Memory V1

Timeline: 1-2 weeks.

Goal: Make Natively remember who the user is, how they prefer to answer, and what recurring relationships or historical facts matter.

Deliverables:

- Memory types:
  - user preference;
  - person/customer relationship;
  - historical event;
  - answer style;
  - taboo or never-use information.
- Memory fields:
  - content;
  - type;
  - source;
  - timestamp;
  - confidence;
  - user-confirmed flag.
- Retrieval flows through `ContextOrchestrator`.
- Settings toggle to disable long-term memory.
- User can view and delete memories.

Acceptance:

- If the user says, "以后回答客户问题直接一点", similar future scenarios reflect that preference.
- Low-confidence memories do not directly enter prompts.
- Deleted memories are no longer retrieved or used.
- Privacy settings are respected.

Risks:

- Long-term memory can become persistent hallucination if low-confidence or stale memories are treated as facts.
- Memories need source, time, confidence, and deletion controls from the first version.

## Phase 4: Read-Only Enterprise Knowledge Connectors

Timeline: 2-3 weeks.

Goal: Reduce manual upload burden without making remote calls block real-time answer generation.

Deliverables:

- Start with 1-2 sources:
  - GitHub docs or repository content;
  - one of Notion, Confluence, or Google Drive.
- Read-only sync.
- Sync content into the local index.
- Incremental refresh.
- Source citations.
- Connection status and last sync time.
- Permission revocation.

Acceptance:

- Enterprise knowledge is synced into local RAG.
- Real-time answers do not block on remote APIs.
- Connector failures do not break the meeting flow.
- Answer citations point back to original documents.

Product naming:

- Expose this as "Knowledge Sources" or "资料来源".
- Do not expose "MCP" to normal users in the first version.

## Phase 5: Quality Evaluation Loop

Timeline: first version in 1 week, then continuous.

Goal: Know whether answer quality is actually improving.

Deliverables:

- Mode-specific eval suites:
  - sales objection;
  - technical interview;
  - team meeting owner/deadline;
  - resume Q&A.
- Metrics:
  - answer latency;
  - citation hit rate;
  - user acceptance rate;
  - regeneration rate;
  - RAG hit rate;
  - no-context answer rate.
- Run evals after changes to prompts, RAG, memory, or context selection.

Acceptance:

- The team can answer whether a change improved answer quality.
- Failures can be attributed to STT, RAG, memory, prompt, model, or context orchestration.

## Phase 6: MCP Read-Only Adapter

Timeline: after enterprise knowledge connectors prove value.

Goal: Add MCP compatibility as an extension layer, not as the first user-facing product surface.

Deliverables:

- MCP read-only resource adapter.
- Allowlist.
- Call logs.
- Timeout and cache policy.
- No write operations.
- No generic MCP server management UI for normal users.

Out of scope:

- Full MCP tool execution.
- Writing CRM records.
- Creating Jira tasks.
- Sending Slack messages.
- Generic automation workflows.

## Recommended Execution Order

```text
Week 1:
  Phase 0: context visibility, quality events, existing RAG/Embedding status fixes.

Week 2-3:
  Phase 1: local RAG, material upload, source citations.

Week 4:
  Phase 2: Context Orchestrator.

Week 5-6:
  Phase 3: long-term memory V1.

Week 7-9:
  Phase 4: read-only enterprise knowledge connectors.

Continuous:
  Phase 5: evals and quality loop.

Later:
  Phase 6: MCP read-only adapter, then only much later write-capable tools.
```

## P0 Requirements

P0 should include only things that decide whether users trust Natively in a live meeting:

- Real-time answer quality evaluation loop.
- Context Orchestrator.
- Local RAG, material upload, and citations.
- Short-term context and speaker stability.
- Visible degradation and setup diagnostics.
- Long-term memory V1, once the above foundation is stable.

## Not P0

- Full MCP tool calling.
- Write actions into CRM, Jira, Slack, or email.
- Generic MCP server management UI.
- Large provider marketplace.
- Complex automation workflow builder.

## Strategic Summary

Local RAG makes answers grounded.

Short-term memory makes answers connected to the current conversation.

Long-term memory makes answers personal to the user.

Enterprise knowledge connectors make the grounding scale without manual uploads.

MCP is useful later as an extension layer. It should not become the first implementation path for the core user value.

The product should first make context accurate, fast, trustworthy, and measurable. Then expand the sources.
