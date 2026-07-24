# 严格限定当前会议搜索 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让会议详情页“搜索本次会议”只依据当前会议完整转录及其结构化摘要回答；Embedding 不可用时仍能关键词检索，无证据时不调用 LLM，并彻底移除普通聊天 fallback。

**Architecture:** renderer 使用带 `requestId` 的会议搜索协议调用独立 IPC；主进程先验证隐私范围和会议，再保证当前会议文本索引与完整转录指纹一致，执行当前会议 lexical-first 混合检索，最后仅在有证据时调用隔离的会议 RAG 流式生成路径。索引重建采用会议级并发锁和数据库事务，流事件同时按 renderer、meetingId、requestId 隔离。

**Tech Stack:** TypeScript、Electron IPC/preload、React 18、SQLite/better-sqlite3、sqlite-vec、Node test runner。

## Global Constraints

- 只修改当前会议搜索链路；不改变全局搜索、上传材料、Knowledge Mode、实时辅助或普通聊天。
- 不增加任何通用聊天 fallback，也不把完整转录直接无裁剪发送给 LLM。
- 所有检索候选、结构化证据和 LLM 上下文都必须能验证属于请求中的 `meetingId`。
- 所有新日志必须使用安全元数据，不记录 query、transcript、prompt、provider 名称、绝对路径或证据正文。
- 严格遵循 TDD：每个行为先增加失败测试，确认失败原因正确后再写最小实现。
- 保留工作区中与本计划无关的现有未提交内容；每次提交只暂存本任务文件。

---

## Task 1: 建立共享会议搜索协议和 v31 数据库迁移

**Files:**

- Create: `shared/meetingSearch.ts`
- Modify: `electron/db/DatabaseManager.ts`
- Create: `electron/services/__tests__/MeetingSearchDatabaseMigration.test.mjs`

- [ ] **Step 1: 写 v31 迁移失败测试**

在 `MeetingSearchDatabaseMigration.test.mjs` 中创建 v30 内存数据库，至少包含 `meetings`、`transcripts`、`chunks` 各一条既有记录。用 `Object.create(DatabaseManager.prototype)` 注入数据库并执行 `runMigrations()`，断言：

```js
assert.equal(db.pragma('user_version', { simple: true }), 31);
assert.deepEqual(
  db.prepare(`
    SELECT rag_transcript_hash, rag_index_state
    FROM meetings
    WHERE id = ?
  `).get('meeting-a'),
  { rag_transcript_hash: null, rag_index_state: 'missing' },
);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM transcripts').get().count, 1);
assert.equal(db.prepare('SELECT COUNT(*) AS count FROM chunks').get().count, 1);
```

再增加迁移原子性测试：在迁移前建立会让第二条 `ALTER TABLE` 失败的冲突列，断言事务回滚后 `user_version` 仍为 30，既有 chunks 未删除。

- [ ] **Step 2: 运行测试，确认因 v31 不存在而失败**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/MeetingSearchDatabaseMigration.test.mjs
```

Expected: FAIL，提示 `rag_transcript_hash` 或 `rag_index_state` 列不存在，或者 `user_version` 仍为 30。

- [ ] **Step 3: 新增共享协议**

在 `shared/meetingSearch.ts` 定义并导出唯一协议源：

```ts
export interface MeetingSearchRequest {
  meetingId: string;
  query: string;
  requestId: string;
}

export type MeetingSearchFailureStatus =
  | 'meeting_not_found'
  | 'transcript_unavailable'
  | 'scope_denied'
  | 'llm_unavailable'
  | 'query_failed';

export type MeetingSearchResult =
  | { status: 'success' }
  | { status: 'cancelled' }
  | { status: 'no_match'; message: string }
  | { status: MeetingSearchFailureStatus; message: string };

export interface MeetingSearchStreamEvent {
  requestId: string;
  meetingId: string;
  global?: false;
}

export type MeetingSearchChunkEvent =
  MeetingSearchStreamEvent & { chunk: string };

export type MeetingSearchCompleteEvent = MeetingSearchStreamEvent;

export type MeetingSearchErrorEvent = MeetingSearchStreamEvent & {
  status: MeetingSearchFailureStatus;
  message: string;
};
```

- [ ] **Step 4: 实现 v31 迁移**

在 `DatabaseManager.runMigrations()` 的 v30 之后增加一个 SQLite 事务：

```ts
if (version < 31) {
  this.db.transaction(() => {
    this.db.exec(`
      ALTER TABLE meetings ADD COLUMN rag_transcript_hash TEXT;
      ALTER TABLE meetings
        ADD COLUMN rag_index_state TEXT NOT NULL DEFAULT 'missing';
    `);
    this.db.pragma('user_version = 31');
  })();
}
```

不要更新、删除或重建既有 `transcripts`、`chunks`。当前迁移框架会让新数据库从 v0 顺序执行到 v31，因此不要同时把字段写入 v0 schema，否则同一次启动执行 v31 时会重复 `ALTER TABLE`。

- [ ] **Step 5: 运行迁移测试和类型检查**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/MeetingSearchDatabaseMigration.test.mjs
rtk npm run typecheck:electron
```

Expected: migration tests 和类型检查都 PASS。

- [ ] **Step 6: 提交**

```bash
rtk git add shared/meetingSearch.ts electron/db/DatabaseManager.ts electron/services/__tests__/MeetingSearchDatabaseMigration.test.mjs
rtk git commit -m "feat(search): define strict meeting search protocol"
```

---

## Task 2: 建立完整转录指纹和原子 chunks 替换

**Files:**

- Create: `electron/rag/MeetingTranscriptFingerprint.ts`
- Modify: `electron/rag/VectorStore.ts`
- Create: `electron/rag/__tests__/MeetingTranscriptIndex.test.mjs`

- [ ] **Step 1: 写指纹与事务失败测试**

测试以下行为：

```js
test('fingerprint is stable for canonical transcript order', () => {
  const a = fingerprintTranscript([
    { id: 2, speaker: '客户', timestampMs: 20, content: '第二句' },
    { id: 1, speaker: '我', timestampMs: 10, content: '第一句' },
  ]);
  const b = fingerprintTranscript([
    { id: 1, speaker: '我', timestampMs: 10, content: '第一句' },
    { id: 2, speaker: '客户', timestampMs: 20, content: '第二句' },
  ]);
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
});
```

还要覆盖 content、speaker、timestamp 任一变化都会改变 hash。

为 `replaceMeetingChunksAtomically()` 建立内存数据库 fixture：先放入旧 chunk、旧 vec、旧 embedding queue；成功替换后断言旧数据全部消失、新 chunks 存在、meeting hash 和 state 为 `complete`。通过 SQLite trigger 主动让新 chunk 插入失败，断言事务回滚后旧 chunk、旧 vec 和旧队列仍完整，状态不为 `complete`。

- [ ] **Step 2: 运行测试，确认缺少新接口**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingTranscriptIndex.test.mjs
```

Expected: FAIL，模块或 `getMeetingChunkState`、`replaceMeetingChunksAtomically` 未定义。

- [ ] **Step 3: 实现规范化 SHA-256 指纹**

`fingerprintTranscript()` 先按 `timestampMs ASC, id ASC` 排序，再逐条向 `createHash('sha256')` 写入：

```ts
`${speaker ?? ''}\u0000${timestampMs}\u0000${content}\u0001`
```

函数只返回 hash，不写日志。输入类型明确包含 `id`、`speaker`、`timestampMs`、`content`。

- [ ] **Step 4: 实现 VectorStore 索引状态接口**

增加：

```ts
type MeetingIndexState = 'missing' | 'building' | 'complete' | 'failed';

getMeetingChunkState(meetingId: string): {
  chunkCount: number;
  transcriptHash: string | null;
  indexState: MeetingIndexState;
};

markMeetingIndexState(
  meetingId: string,
  state: Exclude<MeetingIndexState, 'complete'>,
): void;

replaceMeetingChunksAtomically(
  meetingId: string,
  chunks: Chunk[],
  transcriptHash: string,
): void;
```

原子替换事务必须按顺序删除旧 chunks 对应 vec、删除旧 `embedding_queue`、删除旧 chunks、插入新 chunks、更新 hash 和 `complete`。SQL 删除 vec 时通过旧 chunk IDs 限定，不能清空其他会议数据。

- [ ] **Step 5: 运行 targeted tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingTranscriptIndex.test.mjs
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
rtk git add electron/rag/MeetingTranscriptFingerprint.ts electron/rag/VectorStore.ts electron/rag/__tests__/MeetingTranscriptIndex.test.mjs
rtk git commit -m "feat(search): track complete meeting transcript index"
```

---

## Task 3: 让检索 lexical-first，并强制 meetingId 隔离

**Files:**

- Modify: `electron/rag/RAGRetriever.ts`
- Create: `electron/rag/__tests__/MeetingLexicalFirstRetrieval.test.mjs`

- [ ] **Step 1: 写 lexical-first 行为测试**

用可注入的 fake `VectorStore` 和 fake embedding provider 覆盖：

1. provider 不可用时仍调用 `searchLexical(query, { meetingId: 'a' })` 并返回 lexical 结果；
2. `generateEmbedding()` 抛错时保留 lexical 结果；
3. vector 与 lexical 合并后过滤 `meetingId !== 'a'` 的候选；
4. `searchSimilar()` 和 `searchLexical()` 收到相同 `meetingId`；
5. 空 lexical 且向量不可用时返回空数组，而不是访问全局检索。

关键断言：

```js
assert.deepEqual(result.chunks.map((chunk) => chunk.meetingId), ['meeting-a']);
assert.deepEqual(calls.lexicalOptions, { meetingId: 'meeting-a' });
assert.equal(calls.globalSearch, 0);
```

- [ ] **Step 2: 确认当前 embedding-first 实现导致测试失败**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingLexicalFirstRetrieval.test.mjs
```

Expected: FAIL，embedding 失败时当前实现提前返回空结果。

- [ ] **Step 3: 最小调整 retrieve 顺序**

`retrieve(query, { meetingId })` 必须：

```ts
const lexicalCandidates = await this.vectorStore.searchLexical(retrievalQuery, {
  meetingId,
  limit: topK * 2,
});
let vectorCandidates: ScoredChunk[] = [];

if (this.embeddingPipeline.isReady()) {
  try {
    const vector = await this.embeddingPipeline.getEmbeddingForQuery(retrievalQuery);
    vectorCandidates = await this.vectorStore.searchSimilar(vector, {
      meetingId,
      limit: topK * 2,
      minSimilarity: 0.25,
      spaceKey: this.embeddingPipeline.getActiveSpaceKey(),
    });
  } catch {
    console.warn('[RAGRetriever] semantic retrieval unavailable', {
      meetingIdPresent: Boolean(meetingId),
      errorType: 'embedding_query_failed',
    });
  }
}

let candidates = this.mergeHybridCandidates(
  vectorCandidates,
  lexicalCandidates,
  retrievalQuery,
);
if (meetingId) {
  candidates = candidates.filter((chunk) => chunk.meetingId === meetingId);
}
```

过滤后继续使用现有 re-rank、token budget、格式化和 `RetrievedContext` 返回逻辑。使用项目已有日志/redaction 习惯；不得记录 query、provider、error message 或 chunk text。全局检索继续沿用原有 `retrieveGlobal()` 分支，不能被会议限定过滤破坏。

- [ ] **Step 4: 运行检索与现有 RAG 测试**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingLexicalFirstRetrieval.test.mjs
rtk node --test electron/rag/__tests__/*.test.mjs
```

Expected: PASS。

- [ ] **Step 5: 提交**

```bash
rtk git add electron/rag/RAGRetriever.ts electron/rag/__tests__/MeetingLexicalFirstRetrieval.test.mjs
rtk git commit -m "fix(search): keep meeting lexical retrieval available"
```

---

## Task 4: 按完整转录确保索引，并确定性组装意图证据

**Files:**

- Modify: `electron/db/DatabaseManager.ts`
- Modify: `electron/rag/RAGManager.ts`
- Modify: `electron/rag/RAGRetriever.ts`
- Create: `electron/rag/MeetingEvidenceAssembler.ts`
- Create: `electron/rag/__tests__/MeetingQueryPreparation.test.mjs`
- Create: `electron/rag/__tests__/MeetingEvidenceAssembler.test.mjs`

- [ ] **Step 1: 写索引完整性与并发测试**

为 `prepareMeetingQuery()` 注入 fake database、chunker、vector store、retriever 和 LLM helper，覆盖：

- 会议不存在 → `meeting_not_found`；
- 完整转录为空 → `transcript_unavailable`；
- state 为 `missing`、`building`、`failed`，或 hash 不匹配 → 基于该会议完整转录重建；
- state 为 `complete`、chunkCount > 0、hash 相同 → 不重建；
- 两个同会议并发请求只调用一次 `replaceMeetingChunksAtomically()`；
- 不同会议各自重建，互不复用；
- 重建失败后标记 `failed` 并返回 `query_failed`；
- 空证据 → `no_match` 且 LLM 调用次数为 0；
- 有证据但 LLM 未初始化 → `llm_unavailable`；
- 有证据且 LLM 可用 → `ready`。

并发断言：

```js
const [first, second] = await Promise.all([
  manager.prepareMeetingQuery('meeting-a', '预算'),
  manager.prepareMeetingQuery('meeting-a', '决定'),
]);
assert.equal(replaceCalls, 1);
assert.equal(first.status, 'ready');
assert.equal(second.status, 'ready');
```

- [ ] **Step 2: 写意图证据映射测试**

在 `MeetingEvidenceAssembler.test.mjs` 覆盖：

- 中文“总结一下”识别为 `summary`，优先加入 overview/keyPoints；
- overview/keyPoints 为空时，按完整时间轴均匀选取 chunks，而不是只取首尾；
- “行动项/下一步/跟进/负责/截止”识别为 `action_items`；
- “决定/确定/结论/同意”识别为 `decision_recall`；
- actionItems/decisions 为空时向检索 query 加入规格中的中英文扩展词；
- `speaker_lookup` 保留 speaker 标签；
- 所有证据都有目标 `meetingId`，且统一裁剪到 1500 tokens。

- [ ] **Step 3: 运行测试，确认新 preparation 接口尚不存在**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingQueryPreparation.test.mjs
rtk node --test electron/rag/__tests__/MeetingEvidenceAssembler.test.mjs
```

Expected: FAIL，缺少 `prepareMeetingQuery`、`MeetingEvidenceAssembler` 或索引锁行为。

- [ ] **Step 4: 实现会议级完整索引锁**

先在 `DatabaseManager` 增加只读接口，避免 `RAGManager` 访问私有数据库或用数组序号代替真实记录 ID：

```ts
getMeetingSearchSource(meetingId: string): {
  id: string;
  title: string;
  detailedSummary?: Meeting['detailedSummary'];
  transcript: Array<{
    id: number;
    speaker: string | null;
    timestampMs: number;
    content: string;
  }>;
} | null;
```

该方法从 `meetings.summary_json` 解析 `detailedSummary`，并使用以下查询读取完整转录：

```sql
SELECT id, speaker, timestamp_ms, content
FROM transcripts
WHERE meeting_id = ?
ORDER BY timestamp_ms ASC, id ASC
```

测试必须断言接口不返回其他会议记录，并保留真实 transcript row ID。

在 `RAGManager` 增加：

```ts
private readonly ensureMeetingIndexInFlight = new Map<string, Promise<void>>();
```

`ensureMeetingIndex(meetingId, transcriptRows)` 先计算 hash、检查 state；不一致时复用 map 中已有 Promise。锁内必须重新检查 state/hash，避免等待期间重复构建。构建开始前标记 `building`，调用现有 `preprocessTranscript()`、`chunkTranscript()`，然后原子替换并在 Embedding 可用时入队。catch 中标记 `failed`；finally 只删除仍等于当前 Promise 的 map entry。

禁止扫描其他会议，`LiveRAGIndexer` 不得调用 complete 状态更新。

- [ ] **Step 5: 实现意图证据组装**

`MeetingEvidenceAssembler` 接收当前 meeting record、当前会议检索 chunks、intent，输出：

```ts
interface MeetingEvidence {
  meetingId: string;
  source: 'overview' | 'key_point' | 'action_item' | 'decision' | 'transcript';
  text: string;
  speaker?: string;
  timestampMs?: number;
}
```

实现规格中的固定映射与扩展词。统一预算使用项目已有 token 估算工具；没有现成工具时使用 `Math.ceil(text.length / 4)` 的现有 RAG 估算约定，但只在一个私有函数中实现，避免新增依赖。

- [ ] **Step 6: 拆分准备与流式回答接口**

`RAGManager` 新增：

```ts
prepareMeetingQuery(
  meetingId: string,
  query: string,
): Promise<MeetingQueryPreparation>;

streamMeetingAnswer(
  prepared: Extract<MeetingQueryPreparation, { status: 'ready' }>,
  abortSignal?: AbortSignal,
): AsyncGenerator<string, void, unknown>;
```

`prepareMeetingQuery()` 顺序固定为会议验证、完整转录读取、索引确保、lexical/hybrid 检索、证据组装、空证据判定、LLM 可用性判定。`streamMeetingAnswer()` 只能接收 prepared 中的 `formattedContext`、query、intent，不重新读取材料、模式、画像或全局历史。

- [ ] **Step 7: 运行 targeted tests**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingQueryPreparation.test.mjs
rtk node --test electron/rag/__tests__/MeetingEvidenceAssembler.test.mjs
rtk node --test electron/rag/__tests__/MeetingTranscriptIndex.test.mjs
rtk node --test electron/rag/__tests__/MeetingLexicalFirstRetrieval.test.mjs
```

Expected: PASS。

- [ ] **Step 8: 提交**

```bash
rtk git add electron/db/DatabaseManager.ts electron/rag/RAGManager.ts electron/rag/RAGRetriever.ts electron/rag/MeetingEvidenceAssembler.ts electron/rag/__tests__/MeetingQueryPreparation.test.mjs electron/rag/__tests__/MeetingEvidenceAssembler.test.mjs
rtk git commit -m "feat(search): prepare evidence from full current meeting"
```

---

## Task 5: 在 IPC 层执行隐私预检和 requestId 请求隔离

**Files:**

- Modify: `electron/ipcHandlers.ts`
- Modify: `electron/preload.ts`
- Create: `electron/services/__tests__/MeetingSearchIpc.contract.test.mjs`

- [ ] **Step 1: 写 IPC contract 和行为测试**

测试源代码契约：

```js
assert.doesNotMatch(handlerBlock, /resolveUploadedMaterialChatContext/);
assert.doesNotMatch(handlerBlock, /queryGlobal/);
assert.doesNotMatch(handlerBlock, /gemini-chat-stream/);
assert.match(handlerBlock, /getDeniedDataScopes/);
assert.match(handlerBlock, /prepareMeetingQuery/);
assert.match(handlerBlock, /streamMeetingAnswer/);
```

行为测试通过提取 handler 或现有 IPC 测试 harness 验证：

1. scope denied 时在读取会议转录或执行 retrieval 之前返回 `scope_denied`；
2. token/done/error 事件都携带 requestId、meetingId、`global: false`；
3. 同一 sender + meeting 的新请求 abort 旧请求；
4. 不同 sender 的请求互不 abort；
5. 旧请求 finally 不删除新请求；
6. cancel 只有 requestId 匹配时才取消；
7. 取消返回 `cancelled`，不发送 done/error；
8. 流中 provider 失败发送固定中文 error，并返回同一失败状态。

- [ ] **Step 2: 运行测试，确认旧活动请求键和旧 payload 失败**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/MeetingSearchIpc.contract.test.mjs
```

Expected: FAIL，当前 handler 只按 meetingId 管理请求，事件没有 requestId，且仍返回 fallback。

- [ ] **Step 3: 实现范围预检**

handler 收到 `MeetingSearchRequest` 后先验证非空字段，再读取 `SettingsManager.get('providerDataScopes')`，执行：

```ts
const denied = getDeniedDataScopes(['transcript'], policy);
if (denied.length > 0) {
  return {
    status: 'scope_denied',
    message: '当前隐私设置不允许使用会议转录进行搜索。',
  };
}
```

此判断必须发生在 `prepareMeetingQuery()` 之前。不要采用清空 context 后继续调用模型的策略。

- [ ] **Step 4: 实现 sender + meeting + requestId 隔离**

活动表：

```ts
const activeMeetingSearchRequests = new Map<
  string,
  { requestId: string; controller: AbortController }
>();
const key = `${event.sender.id}:${meetingId}`;
```

新请求 abort 同 key 的旧 controller，写入新记录。stream 事件统一附加：

```ts
{ requestId, meetingId, global: false }
```

catch 先区分 abort，再映射固定中文错误。finally 只有当前 map 记录的 requestId 与本请求一致时才删除。cancel handler 同时校验 sender key 与 requestId。

- [ ] **Step 5: 运行 IPC 测试和类型检查**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/services/__tests__/MeetingSearchIpc.contract.test.mjs
rtk npm run typecheck:electron
```

Expected: IPC 测试和类型检查都 PASS。renderer 此时仍通过旧 preload 签名调用，但 Task 6 必须在一个提交内同步更新 preload、renderer 类型和调用点。

- [ ] **Step 6: 提交**

```bash
rtk git add electron/ipcHandlers.ts electron/preload.ts electron/services/__tests__/MeetingSearchIpc.contract.test.mjs
rtk git commit -m "fix(search): isolate current meeting search requests"
```

---

## Task 6: Renderer 移除普通聊天 fallback，并过滤过期流

**Files:**

- Modify: `src/components/MeetingChatOverlay.tsx`
- Modify: `electron/preload.ts`
- Modify: `src/types/electron.d.ts`
- Modify: `electron/services/__tests__/MeetingSearchRepeat.contract.test.mjs`
- Create: `electron/services/__tests__/MeetingSearchRenderer.contract.test.mjs`
- Modify: `electron/rag/__tests__/RagChineseResponse.contract.test.mjs`

- [ ] **Step 1: 把旧 fallback contract 改成严格边界测试**

删除 `MeetingSearchRepeat.contract.test.mjs` 中“fallback stream completion”测试，保留重复提交 nonce 测试。新增 renderer contract 断言：

```js
assert.doesNotMatch(source, /streamGeminiChat/);
assert.doesNotMatch(source, /buildMeetingFallbackSystemPrompt/);
assert.doesNotMatch(source, /slice\(\s*-20\s*\)/);
assert.doesNotMatch(source, /onGeminiStream/);
assert.match(source, /requestId/);
assert.match(source, /data\.requestId\s*!==\s*activeRequestId/);
assert.match(source, /data\.meetingId\s*!==\s*meetingId/);
assert.match(source, /data\.global\s*===\s*true/);
```

再断言关闭 overlay 会调用 `ragCancelQuery({ meetingId, requestId })`；IPC 最终结果处理前检查 active request；错误状态会清空已收到的 partial content 后显示固定中文文案。

更新 `RagChineseResponse.contract.test.mjs`：删除“会议普通聊天降级”期望，只保留全局普通聊天中文规则，并断言会议搜索不再引用 fallback。

- [ ] **Step 2: 运行测试，确认旧 fallback 导致失败**

Run:

```bash
rtk node --test electron/services/__tests__/MeetingSearchRepeat.contract.test.mjs
rtk node --test electron/services/__tests__/MeetingSearchRenderer.contract.test.mjs
rtk node --test electron/rag/__tests__/RagChineseResponse.contract.test.mjs
```

Expected: FAIL，`MeetingChatOverlay` 仍包含 Gemini fallback 和不带 requestId 的调用。

- [ ] **Step 3: 更新提交与取消逻辑**

先让 `electron/preload.ts` 和 `src/types/electron.d.ts` 从 `shared/meetingSearch.ts` import type，禁止复制协议；把 API 改为：

```ts
ragQueryMeeting: (
  request: MeetingSearchRequest,
) => Promise<MeetingSearchResult>;

ragCancelQuery: (
  options: { meetingId?: string; requestId?: string; global?: boolean },
) => Promise<{ success: boolean }>;
```

会议 RAG 的 chunk/done/error listener payload 分别使用共享事件类型；全局 RAG listener 保持现有类型和行为。

每次提交生成唯一 requestId，并保存到 ref：

```ts
const requestId = generateMessageId();
activeRequestIdRef.current = requestId;
const result = await window.electronAPI.ragQueryMeeting({
  meetingId,
  query: question,
  requestId,
});
if (activeRequestIdRef.current !== requestId) return;
```

新提交前先取消同一 meeting 的旧 requestId。关闭 overlay/unmount 时取消当前请求并清空 ref。

- [ ] **Step 4: 更新流处理与错误显示**

每个会议 RAG listener 先执行同一个 guard：

```ts
if (
  data.requestId !== activeRequestIdRef.current ||
  data.meetingId !== meetingId ||
  data.global === true
) {
  return;
}
```

`no_match` 和准备阶段错误直接用 invoke 结果替换 assistant placeholder。流开始后失败时用固定中文错误完整替换 partial answer。`cancelled` 不显示错误。旧请求的 invoke result 和任何事件都忽略。

删除普通聊天 context 构造、最后 20 条转录、Gemini stream listeners 和 fallback 分支。

- [ ] **Step 5: 运行 renderer contracts 和构建**

Run:

```bash
rtk node --test electron/services/__tests__/MeetingSearchRepeat.contract.test.mjs
rtk node --test electron/services/__tests__/MeetingSearchRenderer.contract.test.mjs
rtk npm run build
```

Expected: PASS。

- [ ] **Step 6: 提交**

```bash
rtk git add src/components/MeetingChatOverlay.tsx electron/preload.ts src/types/electron.d.ts electron/services/__tests__/MeetingSearchRepeat.contract.test.mjs electron/services/__tests__/MeetingSearchRenderer.contract.test.mjs electron/rag/__tests__/RagChineseResponse.contract.test.mjs
rtk git commit -m "fix(search): remove current meeting chat fallback"
```

---

## Task 7: 加固 prompt、日志隐私和双会议隔离回归

**Files:**

- Modify: `electron/rag/prompts.ts`
- Create: `electron/rag/__tests__/MeetingSearchIsolation.test.mjs`
- Create: `electron/services/__tests__/MeetingSearchPrivacy.contract.test.mjs`

- [ ] **Step 1: 写 prompt 与端到端服务回归测试**

`MeetingSearchIsolation.test.mjs` 建立：

- meeting A 转录：“预算为 700 万”；
- meeting B 转录：“预算为 300 万”；
- fake 上传材料、模式资料和画像均包含“300 万”；
- fake LLM 捕获最终 prompt/context。

断言：

```js
assert.match(capturedPrompt, /700 万/);
assert.doesNotMatch(capturedPrompt, /300 万/);
assert.doesNotMatch(capturedPrompt, /上传材料|用户画像|模式参考/);
assert.equal(result.status, 'ready');
```

Embedding 不可用时仍能通过 lexical 找到 700 万。查询“天心”时返回 `no_match` 且 LLM 调用为 0。

prompt contract 断言包含“始终使用简体中文”“只能依据提供的本次会议证据”“不得使用模型记忆”“不得补充证据中不存在的事实”。

- [ ] **Step 2: 写日志隐私 contract**

扫描本次新增/修改的 RAG、IPC、VectorStore 文件中 logger 调用，断言 logger 参数不直接包含：

- `query`
- `transcript`
- `formattedContext`
- `prompt`
- `chunk.text`
- `error.message`
- provider 名称
- `__dirname`/绝对路径

允许字段限定为 status、errorType、chunkCount、durationMs、textLength、meetingIdPresent、requestIdPresent。结合现有 `SensitiveLogRedaction.test.mjs` 跑回归。

- [ ] **Step 3: 运行测试，确认 prompt 或隔离断言先失败**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingSearchIsolation.test.mjs
rtk node --test electron/services/__tests__/MeetingSearchPrivacy.contract.test.mjs
```

Expected: 至少 prompt 新约束测试 FAIL；隔离 harness 在实现未完整接线时也应 FAIL。

- [ ] **Step 4: 最小更新会议 RAG prompt**

只修改 meeting scope 的 prompt 文案，加入：

```text
始终使用简体中文回答。
只能依据下面提供的本次会议证据回答。
不得使用模型记忆、常识或外部资料补充事实。
不得补充证据中不存在的事实；证据不足时明确说明本次会议中没有相关信息。
不要提及 RAG、Embedding、chunks 或内部检索过程。
```

保持 global scope 原行为。

- [ ] **Step 5: 修正测试暴露的日志或输入泄漏**

只修复本次链路中被测试证明存在的泄漏：将原始错误映射为有限 `errorType`，用 boolean/count/length 代替正文。不得为了通过测试删除必要错误处理。

- [ ] **Step 6: 运行隔离和隐私回归**

Run:

```bash
rtk npm run build:electron
rtk node --test electron/rag/__tests__/MeetingSearchIsolation.test.mjs
rtk node --test electron/services/__tests__/MeetingSearchPrivacy.contract.test.mjs
rtk node --test electron/services/__tests__/SensitiveLogRedaction.test.mjs
```

Expected: PASS。

- [ ] **Step 7: 提交**

```bash
rtk git add electron/rag/prompts.ts electron/rag/__tests__/MeetingSearchIsolation.test.mjs electron/services/__tests__/MeetingSearchPrivacy.contract.test.mjs
rtk git commit -m "test(search): enforce current meeting evidence isolation"
```

---

## Task 8: 完整验证和执行记录

**Files:**

- Modify only if tests expose an in-scope defect in Tasks 1–7.

- [ ] **Step 1: 运行全部会议搜索与 RAG tests**

```bash
rtk node --test electron/rag/__tests__/*.test.mjs
rtk node --test electron/services/__tests__/MeetingSearch*.test.mjs
```

Expected: PASS。

- [ ] **Step 2: 运行类型检查与构建**

```bash
rtk npm run typecheck:electron
rtk npm run build:electron
rtk npm run build
```

Expected: PASS。

- [ ] **Step 3: 运行项目测试**

```bash
rtk npm test
```

Expected: PASS。若出现与本计划无关的既有失败，记录完整命令、失败测试名和判断依据；Tasks 1–7 新增及相关会议搜索测试必须全部通过。

- [ ] **Step 4: 检查范围和敏感内容**

```bash
rtk git diff --check
rtk git status --short
rtk git diff --name-only HEAD~7..HEAD
rtk rg -n "streamGeminiChat|buildMeetingFallbackSystemPrompt|slice\\(-20\\)" src/components/MeetingChatOverlay.tsx
```

Expected:

- `git diff --check` 无输出；
- 最后一条 `rg` 无匹配；
- 变更文件都属于本计划；
- 用户原有未提交文件未被暂存或改写。

- [ ] **Step 5: 如验证阶段产生必要修复，单独提交**

仅在验证暴露本计划范围内缺陷时执行。先用 `rtk git diff --name-only` 确认文件，只逐个暂存 Tasks 1–7 已列出的、确实为该缺陷修改的路径；不得使用 `git add .` 或 `git add -u`。随后执行：

```bash
rtk git commit -m "fix(search): close strict meeting search verification gaps"
```

- [ ] **Step 6: 汇报验收结果**

最终汇报必须明确：

- 当前会议搜索已无普通聊天 fallback；
- Embedding 不可用时 lexical 搜索仍工作；
- 没有当前会议证据时不会调用 LLM；
- 完整转录 hash、原子重建和并发锁测试结果；
- requestId 过期事件隔离结果；
- 隔离、隐私、类型检查、构建和全量测试结果；
- 任何与本次无关的既有失败或未提交文件。
