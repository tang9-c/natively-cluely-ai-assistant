# Meeting Performance and Resource Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复长会议转录整量复制、Live RAG 停止竞态和已确认的会议/退出资源释放缺口，同时保持最终转录、实时 RAG 和数据库结构不变。

**Architecture:** `SessionTracker` 提供有界尾部读取；`LiveRAGIndexer` 用单飞 Promise 串行化 tick 与 stop，并在成功处理后压缩输入缓冲；主进程在正确生命周期释放动态动作、截图、图片缓存和 RAG Worker；`EmbeddingPipeline` 在 fallback 队列清空后释放运行态会议 ID。所有行为先由失败测试锁定，再做最小生产改动。

**Tech Stack:** Electron、TypeScript、React 18、Node test runner、better-sqlite3、worker_threads。

## Global Constraints

- 不修改数据库结构，不新增依赖。
- 不丢弃任何最终 SenseVoice 转录。
- 不把本地 Embedding 迁移到 Worker。
- 不移除实时 RAG，不复用实时向量替代最终会议索引。
- 不修改 RAG 分块、召回排序或 provider 路由。
- 直接在当前分支实施，不创建隔离 worktree。
- 保留用户现有 `.tmp/` 和无关工作区改动。

---

### Task 1: 有界有效转录窗口

**Files:**
- Modify: `electron/SessionTracker.ts`
- Modify: `electron/IntelligenceEngine.ts`
- Create: `electron/services/__tests__/SessionTrackerEffectiveTail.test.mjs`

**Interfaces:**
- Produces: `SessionTracker.getEffectiveTranscriptTail(limit: number): TranscriptSegment[]`
- Consumes: 现有 `applySpeakerVerificationOverride()` 和 `fullTranscript`

- [ ] **Step 1: 写入失败测试**

测试构造 30 条最终转录，替换实例上的 `applySpeakerVerificationOverride` 以统计调用次数，并断言读取 12 条尾部记录时只执行 12 次覆盖；同时静态断言技能监听使用新接口。

```js
test('effective transcript tail applies overrides only to requested tail', () => {
  const tracker = new SessionTracker();
  for (let index = 0; index < 30; index += 1) {
    tracker.addTranscript({ speaker: 'user', text: `turn-${index}`, timestamp: index, final: true });
  }
  let calls = 0;
  const original = tracker.applySpeakerVerificationOverride.bind(tracker);
  tracker.applySpeakerVerificationOverride = segment => {
    calls += 1;
    return original(segment);
  };

  const tail = tracker.getEffectiveTranscriptTail(12);
  assert.equal(calls, 12);
  assert.deepEqual(tail.map(item => item.text), Array.from({ length: 12 }, (_, i) => `turn-${i + 18}`));
});
```

- [ ] **Step 2: 构建并确认 RED**

Run:

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --test electron/services/__tests__/SessionTrackerEffectiveTail.test.mjs
```

Expected: FAIL，提示 `getEffectiveTranscriptTail is not a function`。

- [ ] **Step 3: 实施最小生产改动**

在 `SessionTracker` 中增加：

```ts
getEffectiveTranscriptTail(limit: number): TranscriptSegment[] {
    const normalizedLimit = Math.max(0, Math.floor(limit));
    if (normalizedLimit === 0) return [];
    return this.fullTranscript
        .slice(-normalizedLimit)
        .map(segment => this.applySpeakerVerificationOverride(segment));
}
```

将技能监听改为：

```ts
const transcriptWindow = this.session.getEffectiveTranscriptTail(12).map((item) => ({
    speaker: item.speaker,
    text: item.text,
    timestamp: item.timestamp,
}));
```

- [ ] **Step 4: 确认 GREEN**

运行 Task 1 测试以及现有 `SpeakerContextPolicy`、`TranscriptSegmentCoalescer`、技能监听相关测试，预期全部 PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add electron/SessionTracker.ts electron/IntelligenceEngine.ts electron/services/__tests__/SessionTrackerEffectiveTail.test.mjs
git commit -m "perf: bound effective transcript window copies"
```

---

### Task 2: Live RAG 停止单飞与缓冲压缩

**Files:**
- Modify: `electron/rag/LiveRAGIndexer.ts`
- Create: `electron/rag/__tests__/LiveRAGIndexerLifecycle.test.mjs`

**Interfaces:**
- Keeps: `start(meetingId)`, `feedSegments(segments)`, `stop()` 外部签名不变
- Internal: `tick(force?: boolean): Promise<void>` 和 `processingPromise: Promise<void> | null`

- [ ] **Step 1: 写入三个失败测试**

使用 deferred embedding 和内存 fake VectorStore 验证：

```js
test('stop waits for an in-flight tick before returning', async () => {
  const gate = deferred();
  const harness = createHarness({ embeddingGate: gate.promise });
  harness.indexer.start('meeting');
  harness.indexer.feedSegments(threeSegments());
  const tick = harness.indexer.tick();
  await setImmediatePromise();

  let stopped = false;
  const stopping = harness.indexer.stop().then(() => { stopped = true; });
  await setImmediatePromise();
  assert.equal(stopped, false);
  gate.resolve();
  await Promise.all([tick, stopping]);
  assert.equal(harness.indexer.isRunning(), false);
});

test('stop force-flushes fewer than three trailing segments', async () => {
  const harness = createHarness();
  harness.indexer.start('meeting');
  harness.indexer.feedSegments([{ speaker: 'user', text: 'final tail', timestamp: 1 }]);
  await harness.indexer.stop();
  assert.equal(harness.savedChunks.length, 1);
});

test('segments arriving during a tick survive compaction and flush on stop', async () => {
  const gate = deferred();
  const harness = createHarness({ embeddingGate: gate.promise });
  harness.indexer.start('meeting');
  harness.indexer.feedSegments(threeSegments());
  const tick = harness.indexer.tick();
  await setImmediatePromise();
  harness.indexer.feedSegments([{ speaker: 'interviewer', text: 'late segment', timestamp: 4 }]);
  gate.resolve();
  await tick;
  await harness.indexer.stop();
  assert.equal(harness.savedTexts.some(text => text.includes('late segment')), true);
});
```

- [ ] **Step 2: 构建并确认 RED**

运行新测试。预期分别失败于 stop 提前返回、单尾段未保存，以及竞态期间数据所有权不正确。

- [ ] **Step 3: 用单飞 Promise 实施 tick**

将布尔 guard 替换为：

```ts
private processingPromise: Promise<void> | null = null;

private async tick(force: boolean = false): Promise<void> {
    if (this.processingPromise) return this.processingPromise;
    const processing = this.processTick(force);
    this.processingPromise = processing;
    try {
        await processing;
    } finally {
        if (this.processingPromise === processing) this.processingPromise = null;
    }
}
```

`processTick()` 在开始时保存 `batchEnd = allSegments.length`，只处理 `slice(0, batchEnd)`；成功保存后执行 `allSegments.splice(0, batchEnd)`。force 为 false 时保留三段阈值，force 为 true 时只要求至少一段。

- [ ] **Step 4: 修正 stop 顺序**

```ts
async stop(): Promise<void> {
    if (!this.isActive) return;
    if (this.timer) {
        clearInterval(this.timer);
        this.timer = null;
    }
    if (this.processingPromise) await this.processingPromise;
    await this.tick(true);
    this.isActive = false;
    this.meetingId = null;
    this.allSegments = [];
    this.processingPromise = null;
    // reset counters
}
```

- [ ] **Step 5: 确认 GREEN 并回归 RAG 测试**

运行新生命周期测试、`TranscriptCoalescingRagGuard`、`LiveRagQueryGuard` 和全部 `electron/rag/__tests__`，预期全部 PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add electron/rag/LiveRAGIndexer.ts electron/rag/__tests__/LiveRAGIndexerLifecycle.test.mjs
git commit -m "fix: serialize live RAG shutdown"
```

---

### Task 3: 会议结束释放动态动作和截图资源

**Files:**
- Modify: `electron/main.ts`
- Create: `electron/services/__tests__/MeetingTransientResourceCleanup.test.mjs`

**Interfaces:**
- Consumes: `IntelligenceManager.clearDynamicActionContext()`、`AppState.clearQueues()`
- Produces: 不新增 IPC 或数据库接口

- [ ] **Step 1: 写入失败的生命周期合同测试**

测试读取 `endMeeting()` 源码块并要求：Engine 重置、动态动作和截图清理只在 `stopMeeting()` 完成持久化快照后发生，并且位于同一个 `_pendingTeardown` 中。

```js
test('meeting teardown releases engine, actions and screenshots after snapshot', () => {
  const block = extractMethod(mainSource, 'public async endMeeting()', 'private async drainSttFinalsForMeetingStop');
  assert.ok(block.indexOf('this.intelligenceManager.resetEngine()') > block.indexOf('await this.intelligenceManager.stopMeeting()'));
  assert.ok(block.indexOf('this.intelligenceManager.clearDynamicActionContext()') > block.indexOf('await this.intelligenceManager.stopMeeting()'));
  assert.ok(block.indexOf('this.clearQueues()') > block.indexOf('await this.intelligenceManager.stopMeeting()'));
});
```

- [ ] **Step 2: 确认 RED**

运行新合同测试，预期缺少三个清理调用而失败。

- [ ] **Step 3: 实施最小生命周期改动**

在 `const meetingId = await this.intelligenceManager.stopMeeting();` 后依次调用：

```ts
this.intelligenceManager.resetEngine();
this.intelligenceManager.clearDynamicActionContext();
this.clearQueues();
```

不提前清理，确保 transcript、usage 和说话人修正已包含在 MeetingPersistence 快照中。快速开始下一场会议时，现有 `startMeeting()` 会先等待 `_pendingTeardown`，不会误删新会议截图。

- [ ] **Step 4: 确认 GREEN**

运行新测试、MeetingPersistence、DynamicAction 和 ScreenshotHelper 相关测试，预期全部 PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add electron/main.ts electron/services/__tests__/MeetingTransientResourceCleanup.test.mjs
git commit -m "fix: release meeting transient resources"
```

---

### Task 4: 有界图片缓存与正确退出释放

**Files:**
- Modify: `electron/services/screen/ImageOptimizer.ts`
- Modify: `electron/main.ts`
- Modify: `electron/services/__tests__/ImageOptimizer.test.mjs`
- Create: `electron/services/__tests__/AppShutdownResourceCleanup.test.mjs`

**Interfaces:**
- Extend constructor: `new ImageOptimizer(tempDirOverride?: string, maxCacheEntries?: number)`
- Consumes: `getImageOptimizer().cleanupAll()`、`RAGManager.dispose()`、`AppState.clearQueues()`

- [ ] **Step 1: 写入图片缓存失败测试**

以容量 2 创建 optimizer，生成三个不同 cacheKey 的 owned files：

```js
test('cache evicts and deletes the oldest owned file when capacity is exceeded', async () => {
  const optimizer = new ImageOptimizer(tempDir, 2);
  const first = await optimizer.optimize(a, { cacheKey: 'a' });
  await optimizer.optimize(b, { cacheKey: 'b' });
  await optimizer.optimize(c, { cacheKey: 'c' });
  assert.equal(optimizer.getCacheStats().entries, 2);
  await assert.rejects(() => fs.access(first.path));
});
```

- [ ] **Step 2: 确认图片测试 RED**

预期构造器忽略容量且缓存条目为 3。

- [ ] **Step 3: 实施固定容量和淘汰**

增加默认常量和集中写缓存方法：

```ts
const DEFAULT_MAX_CACHE_ENTRIES = 16;

constructor(tempDirOverride?: string, private readonly maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES) {
    this.tempDir = tempDirOverride || path.join(os.tmpdir(), 'natively-vision-optimized');
}

private async remember(cacheKey: string, result: OptimizedImage): Promise<void> {
    this.cache.set(cacheKey, result);
    if (result.ownsFile) this.ownedFiles.set(cacheKey, result.path);
    while (this.cache.size > this.maxCacheEntries) {
        const oldestKey = this.cache.keys().next().value as string | undefined;
        if (!oldestKey) break;
        const ownedPath = this.ownedFiles.get(oldestKey);
        this.cache.delete(oldestKey);
        this.ownedFiles.delete(oldestKey);
        if (ownedPath) await fs.unlink(ownedPath).catch(() => undefined);
    }
}
```

所有 cache 写入统一改为 `await this.remember(cacheKey, result)`。

- [ ] **Step 4: 写入并确认退出清理 RED**

合同测试要求 `before-quit` 使用 `appState.clearQueues()`，不得 `new ScreenshotHelper()`，并调用共享图片 optimizer 与 RAG dispose。

```js
assert.match(beforeQuitBlock, /appState\.clearQueues\(\)/);
assert.doesNotMatch(beforeQuitBlock, /new ScreenshotHelper\(\)/);
assert.match(beforeQuitBlock, /getImageOptimizer\(\)\.cleanupAll\(\)/);
assert.match(beforeQuitBlock, /getRAGManager\(\)\?\.dispose\(\)/);
```

- [ ] **Step 5: 实施退出清理并确认 GREEN**

在 `before-quit` 中执行 best-effort：

```ts
appState.clearQueues();
void getImageOptimizer().cleanupAll().catch(error => {
    console.warn('[Main] Failed to clean optimized images on quit:', error);
});
void appState.getRAGManager()?.dispose().catch(error => {
    console.warn('[Main] Failed to dispose RAG resources on quit:', error);
});
```

运行 ImageOptimizer 全套测试和新退出合同测试，预期全部 PASS。

- [ ] **Step 6: 提交本任务**

```bash
git add electron/services/screen/ImageOptimizer.ts electron/main.ts electron/services/__tests__/ImageOptimizer.test.mjs electron/services/__tests__/AppShutdownResourceCleanup.test.mjs
git commit -m "fix: bound image cache and release shutdown resources"
```

---

### Task 5: 释放完成的 Embedding fallback 会议状态

**Files:**
- Modify: `electron/rag/EmbeddingPipeline.ts`
- Create: `electron/rag/__tests__/EmbeddingPipelineFallbackLifecycle.test.mjs`

**Interfaces:**
- Internal: `releaseMeetingFallbackIfSettled(meetingId: string): void`
- Keeps: 所有公开 EmbeddingPipeline 接口不变

- [ ] **Step 1: 写入失败测试**

使用原型实例和最小 fake DB 调用私有方法，验证无 pending/processing 时删除，有未完成项时保留：

```js
test('completed fallback meeting is removed from runtime routing set', () => {
  const pipeline = Object.create(EmbeddingPipeline.prototype);
  pipeline.fallbackMeetings = new Set(['meeting']);
  pipeline.db = fakeDbReturning(0);
  pipeline.releaseMeetingFallbackIfSettled('meeting');
  assert.equal(pipeline.fallbackMeetings.has('meeting'), false);
});

test('fallback meeting remains while queue work is pending', () => {
  const pipeline = Object.create(EmbeddingPipeline.prototype);
  pipeline.fallbackMeetings = new Set(['meeting']);
  pipeline.db = fakeDbReturning(1);
  pipeline.releaseMeetingFallbackIfSettled('meeting');
  assert.equal(pipeline.fallbackMeetings.has('meeting'), true);
});
```

- [ ] **Step 2: 构建并确认 RED**

预期失败于 `releaseMeetingFallbackIfSettled is not a function`。

- [ ] **Step 3: 实施最小清理方法并接入队列**

```ts
private releaseMeetingFallbackIfSettled(meetingId: string): void {
    if (!this.fallbackMeetings.has(meetingId)) return;
    const row = this.db.prepare(`
        SELECT COUNT(*) AS count
        FROM embedding_queue
        WHERE meeting_id = ? AND status IN ('pending', 'processing')
    `).get(meetingId) as { count: number };
    if ((row?.count ?? 0) === 0) this.fallbackMeetings.delete(meetingId);
}
```

在每个队列项完成状态更新后调用该方法。仍有重试或 processing 项时方法不改变路由。

- [ ] **Step 4: 确认 GREEN**

运行新测试以及 EmbeddingPipeline lazy init、provider resolver、reindex 测试，预期全部 PASS。

- [ ] **Step 5: 提交本任务**

```bash
git add electron/rag/EmbeddingPipeline.ts electron/rag/__tests__/EmbeddingPipelineFallbackLifecycle.test.mjs
git commit -m "fix: release settled embedding fallback state"
```

---

### Task 6: 全量验证与变更收口

**Files:**
- Verify only; do not modify unrelated files

**Interfaces:**
- Consumes: Tasks 1–5 的所有实现
- Produces: 可交付的验证记录

- [ ] **Step 1: 运行专项测试**

```bash
npm run build:electron
ELECTRON_RUN_AS_NODE=1 ./node_modules/.bin/electron --experimental-test-module-mocks --test \
  electron/services/__tests__/SessionTrackerEffectiveTail.test.mjs \
  electron/rag/__tests__/LiveRAGIndexerLifecycle.test.mjs \
  electron/services/__tests__/MeetingTransientResourceCleanup.test.mjs \
  electron/services/__tests__/ImageOptimizer.test.mjs \
  electron/services/__tests__/AppShutdownResourceCleanup.test.mjs \
  electron/rag/__tests__/EmbeddingPipelineFallbackLifecycle.test.mjs
```

Expected: 全部 PASS，无未处理 Promise 或 Worker 残留警告。

- [ ] **Step 2: 运行类型检查和构建**

```bash
npm run typecheck:electron
npm run build
```

Expected: 两条命令 exit code 0。

- [ ] **Step 3: 运行完整测试**

```bash
npm test
```

Expected: 全部测试通过；如存在与本次无关的既有失败，记录测试名称和证据，不修改无关生产代码。

- [ ] **Step 4: 检查工作区**

```bash
git diff --check
git status --short
```

Expected: 无 whitespace error；`.tmp/` 保持未跟踪且未被修改。

- [ ] **Step 5: 更新代码图谱并审查影响范围**

刷新当前仓库代码图谱，检查 `SessionTracker`、`LiveRAGIndexer`、`ImageOptimizer`、`EmbeddingPipeline` 和 `AppState.endMeeting` 的 callers/tests，确认无遗漏调用方。
