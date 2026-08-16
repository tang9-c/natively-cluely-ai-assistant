# 会议性能与资源生命周期修复设计

## 背景

静态调用链审计和受控竞态复现确认了以下问题：

1. 技能监听在每个最终转录片段上调用 `getEffectiveFullTranscript().slice(-12)`，会先映射整场转录再截取尾部，长会议累计产生 O(n²) 级临时数组分配。
2. `LiveRAGIndexer.stop()` 在索引 tick 已运行时不会等待该 tick；停止流程可以先清空状态并返回，而原 tick 随后继续写入向量库。少于三个的尾部片段也可能因常规阈值而未最终 flush。
3. Live RAG 在整场会议期间保留所有已处理 segment，造成一份不必要的完整转录副本。
4. 会议结束后动态动作引擎仍持有 action、`latestTurn` 和 evidence；图片优化缓存及临时文件没有容量上限，也没有接入退出清理。
5. 应用退出时创建新的空 `ScreenshotHelper` 执行清理，实际工作实例中的截图队列没有被清理；`RAGManager.dispose()` 也没有接入退出流程。
6. `EmbeddingPipeline.fallbackMeetings` 只增加不移除，长期运行时会累积已完成会议 ID。

本设计只处理已有证据确认的问题。本地 Embedding 是否造成可感知的 Electron 主线程阻塞尚未经过 event-loop/CPU profile 证明，因此不在本轮迁移到 Worker。实时索引和会后完整索引的双阶段行为继续保留，避免牺牲实时 RAG 或改变最终索引质量。

## 目标

- 技能监听只复制最近所需的转录窗口，复制成本不随整场会议长度增长。
- Live RAG 停止后不存在仍在执行的索引写入，且最终不足三个的 segment 也会被处理。
- Live RAG 成功处理过的 segment 不再整场驻留内存。
- 会议结束后释放动态动作 evidence 和截图队列，并使图片优化缓存保持有界。
- 应用退出时清理真实截图队列，并启动 RAG Worker/定时器释放。
- Embedding fallback 运行态集合不随会议数量无限增长。
- 不丢弃任何最终 SenseVoice 转录，不修改数据库结构，不新增依赖。

## 非目标

- 不把本地 Embedding 迁移到 Worker。
- 不移除实时 RAG，也不尝试复用实时向量作为最终会议索引。
- 不改变 RAG 分块算法、召回排序、数据库 schema 或 Embedding provider 路由。
- 不缩短 SenseVoice `drainFinals()` 等待，不以资源回收为由丢弃最终转录。
- 不改变截图、动态卡片或会议记录的用户交互。

## 设计

### 1. 有界有效转录窗口

在 `SessionTracker` 增加只读取尾部的接口，例如 `getEffectiveTranscriptTail(limit)`：先对 `fullTranscript` 执行 `slice(-limit)`，再仅对这些元素应用说话人覆盖。`IntelligenceEngine.runSkillWatcher()` 改用该接口，不再读取和映射完整转录。

原有 `getEffectiveFullTranscript()` 保留给会议持久化等确实需要完整转录的低频路径，避免扩大接口迁移范围。

### 2. Live RAG 单飞停止与内存压缩

`LiveRAGIndexer` 用一个可等待的 in-flight Promise 表示当前 tick，而不是只使用无法等待的布尔标记：

- 定时 tick 已运行时，其他常规 tick 复用同一个 Promise。
- `stop()` 先清除 interval，再等待当前 tick 完成。
- 当前 tick 完成后，`stop()` 执行一次 `force` flush；force 模式忽略 `MIN_NEW_SEGMENTS`，确保 1–2 个尾部 segment 也被处理。
- force flush 完成后才清空 meeting state 并返回。
- 每次 tick 在开始时记录本次快照边界；成功保存 chunk 后，只移除该边界以内的已处理 segment。处理期间新到达的 segment 保留给下一次 tick。

如果预处理、保存或 embedding 抛错，保留尚未确认处理的 segment，供下一次 tick 或 stop force flush 重试。单个 chunk embedding 失败仍沿用现有“部分索引优于无索引”的语义，不回滚已保存 chunk。

### 3. 会议结束释放会话资源

`endMeeting()` 在 `intelligenceManager.stopMeeting()` 完成快照后重置 Engine，并清除动态动作上下文。此时 usage 已进入持久化快照，取消旧会议请求和清除 action store 不会丢失会议记录。

截图队列在同一个后台 teardown 中、快照和 Engine 重置之后清理。`startMeeting()` 已等待 `_pendingTeardown`，因此新会议不会在清理完成前写入新截图；文件删除继续采用 best-effort，不阻塞停止按钮。

图片优化器不在会议结束时直接执行 `cleanupAll()`，因为并发视觉请求可能仍在使用已优化文件。改为给缓存增加固定容量上限和最旧项淘汰：新增缓存项超过上限时，从 Map 头部移除最旧项，并 best-effort 删除其 owned file。这样即使用户长期使用截图功能，内存索引和临时文件也不会无限增长。

### 4. 退出与 Embedding 运行态清理

退出处理改为调用现有 `appState.clearQueues()`，不再构造空的 `ScreenshotHelper`。

退出处理同时启动共享 `ImageOptimizer.cleanupAll()` 和 `ragManager.dispose()`，分别清除剩余优化文件、取消延迟重索引并终止 VectorStore Worker。退出仍保持 best-effort，不新增复杂的二次 quit 状态机。

`EmbeddingPipeline` 每完成一个 fallback 会议的最后一个 pending/processing 项后，从 `fallbackMeetings` 删除该会议 ID。失败或仍待处理的会议继续保留 fallback 路由状态。

## 数据所有权

- `SessionTracker.fullTranscript` 是会议期间完整转录的唯一业务所有者。
- 技能监听只获得最多 12 条的临时有效窗口。
- `LiveRAGIndexer` 只持有尚未完成实时索引的 segment。
- `DynamicActionEngine` 只在会议动态动作上下文有效期间持有 evidence。
- `VectorStore`/SQLite 是 RAG chunk 和 embedding 的持久化所有者。
- `ScreenshotHelper` 持有当前截图队列中的原始路径；`ImageOptimizer` 持有跨请求复用但容量有上限的优化文件缓存。

## 测试设计

严格按 RED-GREEN-REFACTOR 执行：

1. `SessionTracker` 测试证明尾部接口只对指定数量元素应用覆盖；技能监听不再调用完整转录接口。
2. `LiveRAGIndexer` 测试复现“stop 先返回、旧 tick 后写入”的竞态，修复后要求 stop 等待写入完成。
3. Live RAG 测试证明 stop 会 flush 1–2 个尾部 segment，且 tick 期间新到达的数据不会被错误删除。
4. Live RAG 测试证明成功处理后内存只保留未处理 segment。
5. 动态动作测试证明会议快照完成后上下文被清除，不改变持久化 usage。
6. ImageOptimizer 测试证明缓存超过上限时淘汰最旧项、删除对应 owned file，并保持其他缓存有效。
7. 主进程结构/行为测试证明会议结束清理截图队列，退出使用真实 helper、清理共享图片优化器并调用 RAG dispose。
8. EmbeddingPipeline 测试证明 fallback 会议完成后运行态 ID 被移除，仍有待处理项时不移除。

最终运行相关专项测试、`npm run typecheck:electron`、`npm run build`、完整 `npm test` 和 `git diff --check`。

## 风险控制

- Live RAG 停止顺序用受控 deferred embedding 测试覆盖，避免依赖时间睡眠。
- 图片优化缓存采用有界淘汰；会议结束不直接删除可能仍被并发请求使用的优化文件。
- 所有清理均不触碰数据库中的正式会议记录或最终 transcript。
- 保留工作区已有 `.tmp/`，不创建隔离 worktree。
