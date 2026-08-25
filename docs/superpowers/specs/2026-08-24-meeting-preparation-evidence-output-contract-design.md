# 会议准备证据输出契约修复设计

## 背景与已确认现象

会议准备已经能够把机器人行业案例和产品集成问题正确判定为需要内部资料，但资料检查随后显示“检查失败”。本地复现和运行证据确认：

- 数据库中的失败问题被保存为 `evidenceStatus = null`、`checkError = check_failed`；
- 资料检索返回了命中，否则流程不会调用 `meeting-preparation-evidence`；
- QCLOUD 证据模型调用成功返回；
- 返回后仍进入 `checkEvidence()` 的兜底分支。

因此失败发生在模型调用返回之后，最可能位于结构解析和 Schema 校验。当前兜底 `catch` 丢弃异常，无法看到具体字段路径；当前证据提示词只列字段名称，也没有定义字段类型、JSON 边界和合法示例，而 `evidenceCoverageSchema` 对数组、数字和必填字符串执行严格校验。

## 目标

让证据模型稳定返回满足 `evidenceCoverageSchema` 的结果，并在仍然失败时提供不泄露用户内容的结构化诊断。

## 方案比较

### 方案 A：严格提示词契约与安全诊断（采用）

明确全部字段类型、枚举范围、空值表达、引用约束和完整合法 JSON 示例；继续由现有 Schema 严格拒绝错误输出。失败时只记录错误类型、Zod 字段路径和错误码。

优点是改动小、保留信任边界，并直接解决与此前预测输出相同的类型不确定性。缺点是提示词不能提供绝对确定性保证。

### 方案 B：宽松归一化

把字符串自动包装成数组、把数字字符串转换为数字，再交给 Schema。

该方案会掩盖供应商输出错误，并可能把本来语义错误的引用 ID 转换成有效值，因此不采用。

### 方案 C：移除证据模型评估

只根据检索命中数量或分数计算资料状态。

该方案会失去“支持了什么、还缺什么、承接话术和追问”的语义评估能力，超出本次故障修复范围，因此不采用。

## 设计

### 证据提示词契约

只修改 `buildEvidencePrompt()`，明确：

- 必须只返回一个 JSON 对象，不解释、不使用 Markdown 代码块；
- `coverage` 只能是 `sufficient` 或 `partial`；
- `supported`、`missing`、`limitations`、`followupQuestions` 为字符串数组；
- `citedChunkIds` 为非负整数数组，只能引用输入中存在的 `chunkId`；
- `handlingScript` 为字符串；没有内容时使用空字符串或空数组，不得省略字段；
- 提供包含全部字段的合法 JSON 示例，并明确不得照抄示例内容。

不修改 `evidenceCoverageSchema`，不增加宽松转换，不改变资料检索、证据状态或页面文案。

### 隐私安全诊断

将 `checkEvidence()` 的无参数 `catch` 改为捕获 `error`：

- Zod 错误只记录 `errorType = ZodError`，以及每个 issue 的字段路径和错误码；
- JSON 语法错误只记录 `errorType = SyntaxError`；
- 其他错误只记录安全的错误类名；
- 不记录模型原文、提示词、问题文本、知识要求、检索片段、资料标题或供应商响应体。

业务行为保持不变：检查失败仍返回 `evidenceStatus = null` 和 `checkError = check_failed`，不把技术错误伪装成“缺少资料”。

## 数据流

`资料检索命中` → `buildEvidencePrompt()` → `generateContentStructured()` → `extractAndParse(..., evidenceCoverageSchema)` → `引用 ID 白名单过滤` → `sufficient / partial`

任何异常继续进入现有 `check_failed` 结果，只增加安全诊断，不改变保存结构。

## 测试与验收

- 提示词契约测试锁定 JSON-only、全部字段类型、空值规则和完整示例；
- 安全诊断测试锁定只输出错误类型、字段路径和错误码，并确认日志不含模型原文、问题或资料内容；
- 先运行新增断言确认旧实现失败，再实施最小修改并确认通过；
- 运行会议准备服务定向测试、Electron 类型检查、完整测试集和 `git diff --check`；
- 在真实 Electron 应用中对机器人行业案例和产品集成问题执行“重新检查”，确认不再显示“检查失败”，并显示 `sufficient`、`partial` 或 `missing` 中符合资料情况的状态。

## 已知限制

提示词不能保证所有供应商永远遵守结构。如果强化后仍失败，安全诊断将提供具体字段路径；届时应基于证据决定是否采用供应商原生结构化输出，而不是继续猜测或放宽 Schema。
