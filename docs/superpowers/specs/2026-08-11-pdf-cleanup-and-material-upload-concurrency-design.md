# PDF 清理异常与资料上传并发修复设计

## 背景与已确认根因

资料库存在两个相互独立的缺陷。

第一，`DocumentTextExtractor` 在 `getText()` 已成功返回正文后执行 `parser.destroy()`。当前实现会让清理阶段的异常覆盖正文；当异常消息包含 `worker` 或 `destroyed` 时，系统重试一次后仍将资料标记为 `pdf_worker_failed`。控制实验已稳定复现：两次正文提取均成功，但两次 `destroy()` 抛出 `Worker was destroyed during cleanup`，最终得到 `pdf_worker_failed`。真实 x64 打包应用可以解析最小有效 PDF，因此问题不是 Intel 包普遍缺少 PDF worker，而是成功结果被清理异常错误覆盖；Intel 环境可能更容易暴露该关闭时序。

第二，`KnowledgeMaterialsSettings` 使用同一个 `busy` 状态同时表示前台上传操作和后台索引轮询。上传 IPC 返回 queued 资料后，轮询最长持续 300 次、每次间隔 2 秒；在这段时间内 `busy` 保持为 `true`，而“上传资料”按钮设置了 `disabled={busy}`，所以文件选择窗口不会被调用。

## 方案比较

### 方案 A：修正生命周期语义并拆分状态（采用）

- PDF 正文提取成功后，清理失败不再覆盖正文；解析失败仍按现有策略重试一次。
- 清理失败只记录隐私安全元数据，不记录文件名、路径、正文或原始异常对象。
- UI 的前台操作状态与后台轮询状态解耦。轮询只负责刷新资料状态，不再控制上传按钮。

优点是直接修复两个根因，改动局部，不改变 IPC、数据库和后台队列。缺点是清理失败可能意味着 pdf.js 内部资源未完全释放，因此必须保留诊断日志以便观察频率。

### 方案 B：更换 PDF 解析进程并为上传建立主进程任务系统

把 PDF 解析迁移到显式子进程，同时把资料上传改成可持久化任务。这能提供更强隔离和进度管理，但会引入进程协议、任务恢复、取消语义和新测试矩阵，明显超出两个缺陷的必要范围，不采用。

### 方案 C：仅增加重试并移除按钮 disabled

增加 PDF 重试无法解决每次成功后都被 `destroy()` 覆盖；直接移除 `disabled` 又会允许文件选择和上传 IPC 重入。该方案只处理表象，不采用。

## 生产代码设计

### PDF 生命周期

修改 `electron/services/profile/DocumentTextExtractor.ts`：

1. `getText()` 失败时，保存并抛出解析错误；`extractPdfTextWithParser()` 保持现有瞬态错误重试一次。
2. `getText()` 成功时，先保存正文结果。
3. `finally` 中始终尝试 `parser.destroy()`。
4. 如果正文提取已成功，`destroy()` 异常不得覆盖正文；调用隐私安全日志函数记录：
   - `stage: "cleanup"`
   - 归一化错误码，不记录原始消息
   - `platform: process.platform`
   - `arch: process.arch`
5. 如果正文提取失败，清理异常不得覆盖原始解析异常。

不调整 15 秒超时，不升级或降级 `pdf-parse`，不改变 worker 路径和打包配置。

### 资料上传状态

修改 `src/components/settings/KnowledgeMaterialsSettings.tsx`：

1. 将 `busy` 语义收窄为当前文件选择、上传 IPC、删除或重新索引等前台操作正在提交。
2. `startUploadPolling()` 不再负责设置或清除 `busy`。
3. `uploadMaterials()` 的 `finally` 始终结束前台 busy 状态，即使后台轮询已经启动。
4. 后台轮询继续每 2 秒刷新本批资料，完成或达到 300 次后停止。
5. 上传按钮仅在另一个前台操作正在提交时禁用；资料处于 `queued/indexing` 不影响再次打开文件窗口。

不新增 UI、进度协议或队列并发能力。主进程现有静态 `indexQueue` 继续顺序处理资料，重复上传只会新增排队项。

## 错误处理与隐私

- PDF 清理日志不得包含文件名、文件路径、正文、原始错误消息或堆栈。
- PDF 解析失败仍由现有 `classifyPdfRuntimeError()` 和资料状态映射处理。
- UI 文件选择取消、上传失败、删除失败和重索引失败保持现有提示。
- Ollama、录屏权限和自动更新日志与本修复无关，不做改动。

## 测试设计

### PDF 行为测试

在 `electron/services/__tests__/DocumentTextExtractor.test.mjs` 增加测试：

- `getText()` 成功、`destroy()` 抛出 worker cleanup 异常时，应返回正文且只创建一个 parser。
- `getText()` 失败且 `destroy()` 也失败时，应保留原始解析错误，不能被 cleanup 错误覆盖。
- 现有瞬态解析失败重试测试继续通过。

### 上传行为测试

在 `src/components/__tests__/KnowledgeMaterialsTrustUx.contract.test.mjs` 增加契约断言：

- 轮询函数不得调用 `setBusy(false)`。
- `uploadMaterials()` 的 `finally` 必须无条件调用 `setBusy(false)`，不能依赖 `pollingRef.current`。
- 上传按钮仍保留 `disabled={busy}`，防止前台操作重入。

如现有 React 测试基础设施支持直接交互，再增加行为测试：模拟首批资料处于 indexing，确认下一次点击仍调用 `knowledgeSelectMaterials()`。若没有现成组件测试环境，不为此引入新的测试框架。

## 成功标准

- 控制实验中的“正文成功、destroy 失败”返回正文，不产生 `pdf_worker_failed`。
- 真正的 PDF 解析 worker 失败仍重试一次，并在重试失败后保留现有用户提示。
- 首批资料进入 queued/indexing 后，“上传资料”按钮恢复可点击并能再次打开文件选择窗口。
- 聚焦测试、Electron 类型检查和完整 `npm test` 全部通过。
- `.tmp/` 保持未修改、未暂存。
