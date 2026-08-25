# PPTX Minimal Ingestion Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 60 页以内的 PPTX 在单页提取失败时继续处理成功页面，并以准确的缺页状态完成索引。

**Architecture:** 保留现有“渲染全部页面 → 每页视觉提取 → 每页文本增强 → 最终统一写入 RAG”链路。`PptxIngestionService` 增加页级异常边界并返回统计结果，`KnowledgeMaterialService` 使用现有材料状态和错误字段保存非阻断缺页警告；不增加数据库结构或逐页持久化。

**Tech Stack:** Electron、TypeScript、Node.js test runner、SQLite 现有知识材料表、React 共享状态解释模型。

## Global Constraints

- 单个 `.pptx` 最多 60 页；61 页及以上在任何模型调用前停止。
- 视觉内容提取单次最多 20 秒；文本增强单次最多 20 秒。
- 只有文本增强返回不合法 JSON 时允许重试一次；超时不得重试。
- 单页模型调用累计等待时间不超过 60 秒。
- 单页失败后继续后续页面；所有页面失败时不得创建空索引。
- 部分成功使用现有 `complete + pptx_partial_pages + error_message`，不增加数据库字段。
- 不实现逐页保存、断点续传、并行处理、章节索引或新任务队列。
- 日志不得包含页面正文、提示词、图片路径或图片内容。

---

### Task 1: 限制 PPTX 页数并返回实际页数

**Files:**
- Modify: `electron/services/knowledge/pptx/pptx-render-child.mjs`
- Modify: `electron/services/knowledge/pptx/PptxSlideRenderer.ts`
- Test: `electron/services/knowledge/__tests__/pptxIngestionService.test.mjs`

**Interfaces:**
- Produces: `pptx_page_limit_exceeded` 错误，包含数值型 `slideCount`。
- Consumes: 现有 `PptxSlideRenderer.renderToTempImages(filePath)`。

- [ ] **Step 1: 写失败测试**

模拟渲染目录生成 61 个页面文件并断言：

```js
await assert.rejects(() => renderer.renderToTempImages(sourcePath), (error) => {
  assert.equal(error.code, 'pptx_page_limit_exceeded');
  assert.equal(error.slideCount, 61);
  assert.equal(error.retryable, false);
  return true;
});
```

同时读取 `pptx-render-child.mjs`，断言存在 `slides.length > 60` 和 `pptx_page_limit_exceeded:${slides.length}`。

- [ ] **Step 2: 运行测试并确认失败**

```bash
npm run build:electron && node --test electron/services/knowledge/__tests__/pptxIngestionService.test.mjs
```

Expected: FAIL，当前仍使用 200 页限制或旧错误码。

- [ ] **Step 3: 写最小实现**

子进程在生成页面图片前执行：

```js
if (slides.length > 60) {
  console.error(`pptx_page_limit_exceeded:${slides.length}`);
  process.exit(4);
}
```

为 `PptxRenderError` 和 `createPptxRenderError()` 元数据增加 `slideCount?: number`，并从子进程安全解析：

```ts
const pageLimitMatch = message.match(/pptx_page_limit_exceeded:(\d+)/);
if (pageLimitMatch) {
  finish(createPptxRenderError('pptx_page_limit_exceeded', 'render_child_exit', false, {
    exitCode: code,
    slideCount: Number(pageLimitMatch[1]),
  }));
  return;
}
```

父进程生成文件后的防御性检查也改为 60 页和同一错误码。

- [ ] **Step 4: 运行 Step 2 命令，确认 PASS**

- [ ] **Step 5: 提交**

```bash
git add electron/services/knowledge/pptx/pptx-render-child.mjs electron/services/knowledge/pptx/PptxSlideRenderer.ts electron/services/knowledge/__tests__/pptxIngestionService.test.mjs
git commit -m "fix: limit pptx ingestion to 60 slides"
```

### Task 2: 为两阶段模型调用设置 20 秒超时

**Files:**
- Modify: `electron/services/knowledge/pptx/PptxVisionDescriptor.ts`
- Test: `electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs`

**Interfaces:**
- Consumes: `generatePptxKnowledgeWithNatively(..., options)`。
- Produces: 每次调用传递 `timeoutMs: 20_000`；JSON 格式错误仍只重试一次。

- [ ] **Step 1: 写失败测试**

在视觉、增强和 JSON 重试断言中加入：

```js
assert.equal(calls[0].options?.timeoutMs, 20_000);
assert.equal(calls[1].options?.timeoutMs, 20_000);
```

增加超时不重试测试：LLM 首次抛出 `QCLOUD API request timed out`，断言总调用次数为 1。

- [ ] **Step 2: 运行测试并确认失败**

```bash
npm run build:electron && node --test electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs
```

Expected: FAIL，当前 `timeoutMs` 为 `undefined`。

- [ ] **Step 3: 写最小实现**

```ts
const PPTX_LLM_TIMEOUT_MS = 20_000;

export interface PptxKnowledgeLlm {
  generatePptxKnowledgeWithNatively(
    userMessage: string,
    systemPrompt?: string,
    imagePaths?: string[],
    options?: { maxOutputTokens?: number; timeoutMs?: number },
  ): Promise<string>;
}
```

视觉和增强的 options 都加入 `timeoutMs: PPTX_LLM_TIMEOUT_MS`。保持 catch 仅在 `pptx_enhance_invalid_json` 时重试，因此超时不会重试。

- [ ] **Step 4: 运行 Step 2 命令，确认 PASS**

- [ ] **Step 5: 提交**

```bash
git add electron/services/knowledge/pptx/PptxVisionDescriptor.ts electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs
git commit -m "fix: bound pptx slide model calls"
```

### Task 3: 隔离单页失败并只索引成功页面

**Files:**
- Modify: `electron/services/knowledge/pptx/PptxIngestionService.ts`
- Test: `electron/services/knowledge/__tests__/pptxIngestionService.test.mjs`

**Interfaces:**
- Produces: `PptxIngestionResult = { slideCount, successCount, failedSlideIndexes }`。
- Throws: `pptx_page_limit_exceeded` 或 `pptx_all_slides_failed`。

- [ ] **Step 1: 写失败测试**

增加三个行为测试：61 页 fake deck 在 descriptor 调用前失败；第二页失败时第一、三页仍被索引且保留原始页码；全部页面失败时不调用索引并抛出 `pptx_all_slides_failed`。

部分成功核心断言：

```js
const result = await service.ingest('mat_1', '/tmp/deck.pptx');
assert.deepEqual(result, { slideCount: 3, successCount: 2, failedSlideIndexes: [2] });
assert.deepEqual(chunks.map((chunk) => chunk.metadata.slide_index), [1, 3]);
assert.deepEqual(chunks.map((chunk) => chunk.chunkIndex), [0, 2]);
```

- [ ] **Step 2: 运行测试并确认失败**

```bash
npm run build:electron && node --test electron/services/knowledge/__tests__/pptxIngestionService.test.mjs
```

Expected: FAIL，第二页异常当前会终止整个循环。

- [ ] **Step 3: 写最小实现**

```ts
export interface PptxIngestionResult {
  slideCount: number;
  successCount: number;
  failedSlideIndexes: number[];
}
```

在循环内部用 `try/catch` 包裹视觉和增强两阶段。失败时只记录页码并继续。循环后：

```ts
if (chunks.length === 0) {
  const error = new Error('pptx_all_slides_failed') as Error & { code?: string };
  error.code = 'pptx_all_slides_failed';
  throw error;
}
await this.indexPreparedChunks(materialId, chunks);
return { slideCount, successCount: chunks.length, failedSlideIndexes };
```

60 页防御性错误携带 `slideCount`，所有路径继续通过 `finally` 清理临时目录。

- [ ] **Step 4: 运行 Step 2 命令，确认 PASS**

- [ ] **Step 5: 提交**

```bash
git add electron/services/knowledge/pptx/PptxIngestionService.ts electron/services/knowledge/__tests__/pptxIngestionService.test.mjs
git commit -m "fix: isolate pptx slide extraction failures"
```

### Task 4: 持久化部分成功状态并保留重新索引警告

**Files:**
- Modify: `electron/services/knowledge/KnowledgeMaterialService.ts`
- Test: `electron/services/__tests__/KnowledgeMaterialService.pptx.test.mjs`
- Test: `electron/services/__tests__/KnowledgeMaterialService.errors.test.mjs`
- Test: `electron/services/__tests__/KnowledgeMaterialService.reindex.test.mjs`

**Interfaces:**
- Consumes: `PptxIngestionResult | void`。
- Produces: `status='complete'`、`error_code='pptx_partial_pages'` 和准确计数消息。

- [ ] **Step 1: 写失败测试**

部分成功断言：

```js
assert.equal(material.status, 'complete');
assert.equal(material.error_code, 'pptx_partial_pages');
assert.equal(material.error_message, '处理完成，但有缺页 · 2/3 页');
```

错误文案断言：

```js
assert.equal(
  toUserFacingMaterialError({ code: 'pptx_page_limit_exceeded', slideCount: 107 }),
  '该 PPTX 共 107 页，当前单个文件最多处理 60 页。请按章节拆分为多份，每份不超过 60 页后重新上传。',
);
assert.equal(toUserFacingMaterialError({ code: 'pptx_all_slides_failed' }), 'PPTX 内容提取失败，请稍后重试。');
```

重新索引测试预置 `complete + pptx_partial_pages`，断言重新索引后相同错误码和计数消息仍存在。

- [ ] **Step 2: 运行测试并确认失败**

```bash
npm run build:electron && node --test electron/services/__tests__/KnowledgeMaterialService.pptx.test.mjs electron/services/__tests__/KnowledgeMaterialService.errors.test.mjs electron/services/__tests__/KnowledgeMaterialService.reindex.test.mjs
```

Expected: FAIL，当前忽略 ingestion 返回值且重新索引清空警告字段。

- [ ] **Step 3: 写最小实现**

扩展可注入 ingestion 的返回类型。PPTX 完成后：

```ts
const result = await service.ingest(materialId, filePath);
if (result && result.successCount < result.slideCount) {
  this.db.updateKnowledgeMaterialStatus(materialId, 'complete', {
    code: 'pptx_partial_pages',
    message: `处理完成，但有缺页 · ${result.successCount}/${result.slideCount} 页`,
  });
}
```

重新索引前保存 `pptx_partial_pages` 警告，索引成功后恢复。分类和用户文案新增 `pptx_page_limit_exceeded`、`pptx_all_slides_failed`；旧 `pptx_too_many_slides` 兼容映射到 60 页提示。

- [ ] **Step 4: 运行 Step 2 命令，确认 PASS**

- [ ] **Step 5: 提交**

```bash
git add electron/services/knowledge/KnowledgeMaterialService.ts electron/services/__tests__/KnowledgeMaterialService.pptx.test.mjs electron/services/__tests__/KnowledgeMaterialService.errors.test.mjs electron/services/__tests__/KnowledgeMaterialService.reindex.test.mjs
git commit -m "fix: preserve partial pptx material status"
```

### Task 5: 显示非阻断缺页警告

**Files:**
- Modify: `shared/realtimeAnswerTrustViewModel.ts`
- Test: `electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs`

**Interfaces:**
- Consumes: `complete + pptx_partial_pages`。
- Produces: warning 严重度、仍可重新索引的状态解释。

- [ ] **Step 1: 写失败测试**

```js
const explanation = explainMaterialStatus({
  status: 'complete',
  errorCode: 'pptx_partial_pages',
  errorMessage: '处理完成，但有缺页 · 59/60 页',
});
assert.equal(explanation.label, '处理完成，但有缺页');
assert.match(explanation.message, /59\/60 页/);
assert.equal(explanation.severity, 'warning');
assert.equal(explanation.canReindex, true);
```

- [ ] **Step 2: 运行测试并确认失败**

```bash
npm run build:electron && node --test electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
```

Expected: FAIL，当前所有 `complete` 都显示普通成功。

- [ ] **Step 3: 写最小实现**

在普通 `complete` 分支之前识别：

```ts
const code = material.errorCode ?? material.error_code ?? '';
if (status === 'complete' && code === 'pptx_partial_pages') {
  return {
    label: '处理完成，但有缺页',
    message: material.errorMessage ?? material.error_message ?? '部分页面内容提取失败，其余页面已可用于回答。',
    severity: 'warning',
    canReindex: true,
    primaryActionLabel: '重新索引',
  };
}
```

- [ ] **Step 4: 运行 Step 2 命令，确认 PASS**

- [ ] **Step 5: 提交**

```bash
git add shared/realtimeAnswerTrustViewModel.ts electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
git commit -m "fix: show partial pptx completion warning"
```

### Task 6: 完整验证

**Files:**
- Verify only.

**Interfaces:**
- Consumes: Tasks 1–5 全部行为。
- Produces: 构建、目标测试和完整测试证据。

- [ ] **Step 1: 运行目标测试**

```bash
npm run build:electron && node --test electron/services/knowledge/__tests__/pptxIngestionService.test.mjs electron/services/knowledge/__tests__/pptxVisionDescriptor.contract.test.mjs electron/services/__tests__/KnowledgeMaterialService.pptx.test.mjs electron/services/__tests__/KnowledgeMaterialService.errors.test.mjs electron/services/__tests__/KnowledgeMaterialService.reindex.test.mjs electron/services/eval/__tests__/RealtimeAnswerTrustViewModel.test.mjs
```

Expected: PASS。

- [ ] **Step 2: 运行类型检查和生产构建**

```bash
npm run typecheck:electron
npm run build
```

Expected: 两条命令均以 0 退出。

- [ ] **Step 3: 运行完整测试**

```bash
npm test
```

Expected: 全部测试通过，无新增失败。

- [ ] **Step 4: 检查改动范围**

```bash
git status --short
git diff --check
git log --oneline -6
```

Expected: 只有计划内文件发生修改；`.tmp/` 和 `design-qa.md` 保持未跟踪且未修改。
