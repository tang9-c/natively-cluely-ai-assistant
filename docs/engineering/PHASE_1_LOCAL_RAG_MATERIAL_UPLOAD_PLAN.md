# Phase 1：本地 RAG 与资料上传验收收口方案

## Summary

本阶段目标是把现有资料库、Material RAG、实时上下文 trace 和引用 UI 收口为可验收产品能力。第一版只验收 PDF、DOCX、Markdown、TXT，不实现 PPTX 解析，不新增 OCR、Office 转换或云端文档解析依赖。

关键产品验收：

- 批量上传 PDF、DOCX、Markdown、TXT 后，用户能看到文件级状态：排队中、索引中、已完成、索引失败。
- 上传的产品 FAQ 能在会议问答中被检索、注入、引用，并写入 answer trace。
- embedding 未配置或失败时，上传不失败，但设置页和回答 trace 必须展示明确降级。
- 删除资料后，该资料不再被检索，也不能作为有效 citation 打开。
- PPTX 只显示“即将支持”，提示用户先导出为 PDF 或 Markdown。

本阶段不新增 `RealtimeAnswerContextRetriever`，不替换现有 `KnowledgeMaterialService`、`MaterialRagRetriever`、`RealtimeContextOrchestrator` 链路，只在现有链路上补验收缺口。

## Key Changes

### 1. 上传入口与格式边界

- 资料选择器继续只允许 `pdf/docx/txt/md/markdown`。
- `KnowledgeMaterialService` 的服务端白名单继续只允许 `.pdf/.docx/.txt/.md/.markdown`，PPTX 必须被拒绝。
- `KnowledgeMaterialsSettings` 增加静态提示：
  - `PPTX 即将支持；当前请先导出为 PDF 或 Markdown 后上传。`
- 不做“选择 PPTX 后提示”，因为系统文件选择器过滤后用户无法选择 PPTX；提示必须在资料库 UI 中常驻可见。

### 2. 最小异步索引与状态可见

当前 `uploadFile()` 同步解析并 `await indexMaterial()`，用户几乎看不到 `queued/indexing`。本阶段必须改为最小异步模型：

- `knowledge:upload-materials` 对每个文件先创建 material 记录并立即返回，状态为 `queued`。
- 后台串行启动索引任务：`queued -> indexing -> complete/failed`。
- 同一进程内维护轻量 index runner，不新增独立 worker 进程，不新增数据库。
- UI 在上传后短周期 polling `knowledge:list-materials`，直到本批文件均进入 `complete/failed` 或用户离开页面。
- 每个文件独立处理；一个文件解析慢或失败，不阻塞其它文件创建 material 记录。

### 3. 失败记录与错误码

解析失败也必须留下 failed material 记录，而不是只在 toast 中显示错误。建议错误码集合：

- `unsupported_file_type`
- `parse_failed`
- `empty_document`
- `binary_text_file`
- `index_failed`
- `embedding_failed`

实现要求：

- 创建 material 记录前可以读取文件名、扩展名和基本文件 stat，但不要解析全文。
- 解析、chunk、embedding 任一阶段失败，都写入 `status='failed'`、`error_code`、`error_message`。
- `listKnowledgeMaterials()` 返回错误字段给 UI。
- UI 展示中文状态和可读错误，不展示原始堆栈。

### 4. Embedding 降级与检索语义

- embedding 未 ready 时，资料仍可上传并完成文本索引。
- 检索走现有 lexical fallback，并在 answer trace / context plan 中记录 `embedding_unavailable`。
- 设置页通过 `get-context-health` 显示 embedding 状态：
  - embedding ready：资料检索正常。
  - embedding unavailable：`资料仍可上传，但检索将降级为关键词匹配，回答可能不稳定。`
- 不允许 UI 暗示“向量检索已使用”，除非 embedding pipeline ready 且实际参与检索。

### 5. 删除与引用安全

- 删除 material 时继续软删除 material，并删除 chunks 与 `material_embedding_queue` 记录。
- 检索只能读取 `status='complete'` 的资料。
- citation resolver 也必须只把 `status='complete'` 的资料视为有效；`deleted/failed/indexing/queued` 的旧 citation 应返回 `missing-citation` 或 `stale-citation`，不得返回 `ok`。
- 删除后的同一 FAQ 问题必须 `uploadedMaterialHitCount === 0`，不能出现旧 citation。

### 6. 评测防幻觉标准

产品 FAQ fixture 必须包含唯一事实，例如：

- `CueUp Enterprise includes SSO and audit log export.`
- `The refund window is 14 days.`
- `API integration requires a workspace token.`

验收时不只检查 citation，还要检查：

- 答案包含至少一个 FAQ 唯一事实。
- 答案没有包含 fixture 中明确不存在的反事实，例如 `30 days refund`。
- trace 中 `uploadedMaterialHitCount > 0`。
- citation source title 指向上传 FAQ。

为避免云模型不稳定，第一版评测使用可控 LLM stub 或 answer generation contract，不依赖真实云模型输出。

## Implementation Tasks

### Task 1：UI 与契约收口

- 修改 `KnowledgeMaterialsSettings`：
  - 支持格式文案改为 PDF、DOCX、Markdown、TXT。
  - 增加 PPTX 即将支持提示。
  - 增加中文状态映射：`queued/indexing/complete/failed/deleted`。
  - 失败状态展示 `error_message`。
  - 上传后启动 polling；批次结束后停止 polling。
- 更新类型/contract test，确认 PPTX 不在选择器 filter 和服务白名单中。

### Task 2：Material service 最小异步索引

- 拆分 `uploadFile()`：
  - `createMaterialRecord(filePath)`：创建 `queued` material 并返回。
  - `indexMaterialFromFile(materialId, filePath)`：后台解析并索引。
- `uploadFiles()` 先为所有文件创建记录，再串行或限并发执行索引。
- 解析失败和索引失败都保留 failed material 记录。
- 保持不新增持久后台队列；应用重启后的 queued/indexing 恢复可在后续阶段处理，本阶段只需避免当前会话内状态不可见。

### Task 3：Embedding 诊断与降级提示

- 扩展设置页资料库区域或上下文健康区域，展示 embedding ready/unavailable。
- 确认 `generate-what-to-say` 路径在 material RAG attempted 且 embedding 不 ready 时写入 `embedding_unavailable`。
- 确认 `uploaded_material_rag_failed`、`no_relevant_uploaded_material` 用户文案准确，不误导用户以为资料已使用。

### Task 4：删除、citation 与检索回归

- 更新 `getKnowledgeMaterialChunkById()` 或 resolver 逻辑，使 citation 只对 `complete` material 有效。
- 增加删除后不可检索测试。
- 增加旧 citation 在删除后不可打开为有效引用测试。

### Task 5：资料支撑型评测接入

- 新增固定 FAQ fixture，覆盖 PDF、DOCX、Markdown、TXT。
- 新增 material answer quality smoke suite：
  - 上传 FAQ。
  - 提问相关问题。
  - 验证 context plan 注入 uploaded material。
  - 验证 citation 指向 FAQ。
  - 验证答案使用 FAQ 唯一事实且不包含反事实。
- 将该 suite 纳入 `test:quality:smoke` 或提供明确 no-build 子命令，并在路线图中记录固定命令。

## Test Plan

必须新增或更新以下测试：

- `DocumentTextExtractor.test.mjs`
  - PDF、DOCX、Markdown、TXT 正常提取。
  - 空文件、损坏文件、二进制伪 TXT 失败。
- `contextVisibilityMaterialRag.contract.test.mjs`
  - 支持格式为 PDF/DOCX/Markdown/TXT。
  - PPTX 不在 upload filter 和服务白名单。
  - UI 包含 PPTX 即将支持提示。
- `KnowledgeMaterialService` 新测试文件
  - 批量上传部分成功、部分失败。
  - queued/indexing/complete/failed 状态流转。
  - 解析失败创建 failed material。
  - embedding 不 ready 时仍 complete，并可 lexical fallback。
  - delete 后 search 不返回。
- `RealtimeCitationIntegrity.test.mjs`
  - deleted material citation 为 missing/stale。
  - failed/indexing material citation 不返回 ok。
- `UploadedMaterialAnswerQuality` 新评测
  - FAQ 被选择、被注入、被引用。
  - 删除 FAQ 后不再被引用。
  - embedding unavailable 有降级状态。

固定验证命令：

```bash
npm run build:electron
npm run typecheck:electron
ELECTRON_RUN_AS_NODE=1 npx electron --test electron/services/__tests__/DocumentTextExtractor.test.mjs electron/services/__tests__/contextVisibilityMaterialRag.contract.test.mjs electron/services/__tests__/RealtimeCitationIntegrity.test.mjs
npm run test:quality:smoke
npm run test:quality:diagnostics
git diff --check
```

## Assumptions

- PPTX 支持另开阶段，不在 Phase 1 内实现。
- 本阶段不新增 PPTX、OCR、LibreOffice、Pandoc、云端文档转换依赖。
- 不新增数据库或独立后台进程。
- queued/indexing 跨重启恢复不作为本阶段验收要求；当前会话内状态可见即可。
- 不保存或记录 raw material full text 到日志；测试必须覆盖敏感日志不泄露。
