# QCloud STT Latency Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不改变 QCloud 生产默认行为的前提下，建立可重复、可恢复且隐私安全的分阶段延迟诊断，量化轮询间隔、分段长度和 VAD 参数对会议实时体验的影响，并产出有证据支撑的优化结论。

**Architecture:** 在现有 QCloud AUC 客户端增加可选阶段观察器；扩展现有 renderer 基准运行器，使单次样本携带参数、质量和阶段耗时；新增纯函数诊断库与串行矩阵编排器，负责断点续跑、胜者选择和最终报告。生产调用不传观察器，保持当前默认值和控制流不变。

**Tech Stack:** Node.js ESM、Electron/TypeScript、Node test runner、QCloud AUC API、现有性能基线 JSON 报告。

## Global Constraints

- 不修改生产默认分段长度、VAD 参数或 2000ms 轮询间隔。
- 不硬改为流式 STT，不绕过现有 QCloud AUC 客户端。
- 不读取、合并、变基或比较 `main`；所有工作仅在 `ci/intel-mac-workflow`。
- 不记录 API Key、原始音频、原始转录文本、请求体或响应体。
- 所有失败只输出脱敏阶段码；不得把通用 `Error.message` 直接写入报告。
- 每个矩阵单元只统计有效样本；失败样本单独计数且不可伪装为有效样本。
- 当前工作区已有未提交性能改动，提交时只暂存本 Task 明确列出的文件。

## File Map

- Modify: `electron/audio/doubaoAucClient.ts`
- Create: `electron/audio/__tests__/DoubaoAucClientPhases.test.mjs`
- Create: `scripts/lib/qcloudSttDiagnostics.mjs`
- Create: `scripts/__tests__/qcloud-stt-diagnostics.test.mjs`
- Modify: `scripts/run-sales-local-stt-benchmark.mjs`
- Modify: `scripts/benchmark-qcloud-stt-renderer.mjs`
- Create: `scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs`
- Create: `scripts/run-qcloud-stt-diagnostics-matrix.mjs`
- Create: `scripts/__tests__/run-qcloud-stt-diagnostics-matrix.test.mjs`
- Modify: `package.json`
- Generate: `reports/performance/m4-16gb/qcloud-stt-diagnostics/*.json`（忽略文件，不提交）

## Task 0: 收口当前未提交的性能基线改动

**Files:**
- Modify: `package.json`
- Modify: `scripts/__tests__/run-performance-baseline.test.mjs`
- Modify: `scripts/run-performance-baseline.mjs`
- Modify: `scripts/run-sales-local-stt-benchmark.mjs`
- Create: `scripts/benchmark-qcloud-stt-renderer.mjs`

**Acceptance:** 现有 QCloud STT renderer 基线功能通过其测试并形成独立提交；不得夹带本计划尚未实现的诊断矩阵代码。

- [ ] **Step 1: 审查当前 diff 与提交边界**

确认这些改动只属于已经完成的统一性能基线和 QCloud renderer 报告接入。若发现与本诊断方案无关或未完成的代码，先明确拆分，不得盲目提交。

- [ ] **Step 2: 运行现有基线测试**

Run: `node --test scripts/__tests__/run-performance-baseline.test.mjs`

Expected: PASS。

Run: `node --check scripts/benchmark-qcloud-stt-renderer.mjs scripts/run-sales-local-stt-benchmark.mjs scripts/run-performance-baseline.mjs`

Expected: PASS。

- [ ] **Step 3: 检查格式与敏感信息**

Run: `git diff --check -- package.json scripts/__tests__/run-performance-baseline.test.mjs scripts/run-performance-baseline.mjs scripts/run-sales-local-stt-benchmark.mjs scripts/benchmark-qcloud-stt-renderer.mjs`

确认 diff 中没有凭据、原始转录、请求体或响应体。

- [ ] **Step 4: 独立提交既有功能**

```bash
git add package.json scripts/__tests__/run-performance-baseline.test.mjs scripts/run-performance-baseline.mjs scripts/run-sales-local-stt-benchmark.mjs scripts/benchmark-qcloud-stt-renderer.mjs
git commit -m "perf: integrate QCloud STT renderer baseline"
```

## Task 1: 为 QCloud AUC 客户端增加可选阶段观察器

**Files:**
- Modify: `electron/audio/doubaoAucClient.ts`
- Create: `electron/audio/__tests__/DoubaoAucClientPhases.test.mjs`

**Acceptance:** 未传观察器时行为与当前完全一致；成功路径按顺序产生脱敏阶段事件；观察器抛错不会中断转录；测试不访问网络。

- [ ] **Step 1: 编写失败测试，锁定阶段事件契约**

测试通过 mock `postMultipart`、`fetchImpl`、`sleepImpl` 覆盖以下事件：

```js
[
  'submit_started',
  'submit_completed',
  'poll_started',
  'poll_completed',
  'task_completed',
  'result_parsed',
]
```

断言事件只包含 `phase`、`atMs`、`attempt`、`taskStatus`、`durationMs` 等非敏感字段，不包含 headers、body、audio、transcript、taskId。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test electron/audio/__tests__/DoubaoAucClientPhases.test.mjs`

Expected: FAIL，原因是 options 尚无 `onPhase`，且没有阶段事件。

- [ ] **Step 3: 实现最小可选观察器**

在 `NewApiDoubaoAucMultipartOptions` 增加：

```ts
type QCloudAucPhase =
  | 'submit_started'
  | 'submit_completed'
  | 'poll_started'
  | 'poll_completed'
  | 'task_completed'
  | 'result_parsed';

onPhase?: (event: QCloudAucPhaseEvent) => void;
```

要求：

- 使用现有 `nowMs` 或注入时钟计算耗时，避免测试依赖真实时间。
- 用内部 `emitPhase()` 包裹回调并吞掉观察器异常。
- 不发送 task id、URL、响应体、文本和凭据。
- 不改变现有 submit/poll 次序、默认间隔、重试上限和返回值。

- [ ] **Step 4: 补充失败与观察器异常测试**

覆盖 submit 失败、poll 失败、观察器自身抛错。断言原始业务错误仍按既有方式抛出，观察器错误不影响成功结果。

- [ ] **Step 5: 运行局部验证**

Run: `node --test electron/audio/__tests__/DoubaoAucClientPhases.test.mjs`

Expected: PASS。

Run: `npm run typecheck:electron`

Expected: PASS。

- [ ] **Step 6: 自审并提交**

Run: `git diff --check -- electron/audio/doubaoAucClient.ts electron/audio/__tests__/DoubaoAucClientPhases.test.mjs`

只暂存本 Task 文件并提交：

```bash
git add electron/audio/doubaoAucClient.ts electron/audio/__tests__/DoubaoAucClientPhases.test.mjs
git commit -m "test: expose QCloud STT phase timings"
```

## Task 2: 建立诊断统计、脱敏和胜者选择纯函数

**Files:**
- Create: `scripts/lib/qcloudSttDiagnostics.mjs`
- Create: `scripts/__tests__/qcloud-stt-diagnostics.test.mjs`

**Acceptance:** 对固定输入稳定地产生 p50/p95、失败率、质量统计和胜者；任何失败详情只保留允许的阶段码。

- [ ] **Step 1: 编写失败测试定义报告数据模型**

测试至少覆盖：

- `summarizeSamples(samples)` 忽略无效耗时并分别统计 valid/failed。
- 延迟字段包含 submit、poll、provider-processing、parse、submit-to-final、final-to-renderer、end-to-end。
- `sanitizeFailure(error, phase)` 只返回枚举阶段码，例如 `submit_failed`、`poll_failed`、`parse_failed`、`renderer_timeout`、`quality_rejected`。
- `chooseWinner(cells)` 按失败率、质量门槛、p95、请求数顺序选择。
- p95 差异小于 5% 时选择请求更少者；完全相同则保留当前默认。
- 质量未达门槛的候选不得因延迟更低而获胜。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test scripts/__tests__/qcloud-stt-diagnostics.test.mjs`

Expected: FAIL，模块不存在。

- [ ] **Step 3: 实现最小纯函数库**

导出：

```js
export function percentile(values, percentileValue) {}
export function sanitizeFailure(error, phase) {}
export function summarizeSamples(samples, qualityThresholds) {}
export function chooseWinner(cells, currentDefaultId) {}
export function buildExperimentMatrix(config) {}
```

报告中只保留数值、布尔值、参数枚举、阶段码和聚合统计。质量门槛沿用现有 benchmark 的参考窗口与文本比较结果，不在此模块保存文本。

- [ ] **Step 4: 添加边界测试**

覆盖空样本、单样本、偶数样本、全部失败、NaN/负值、恰好 5% 差异、候选缺少质量字段、未知异常。

- [ ] **Step 5: 运行验证**

Run: `node --test scripts/__tests__/qcloud-stt-diagnostics.test.mjs`

Expected: PASS。

- [ ] **Step 6: 自审并提交**

Run: `git diff --check -- scripts/lib/qcloudSttDiagnostics.mjs scripts/__tests__/qcloud-stt-diagnostics.test.mjs`

```bash
git add scripts/lib/qcloudSttDiagnostics.mjs scripts/__tests__/qcloud-stt-diagnostics.test.mjs
git commit -m "test: add QCloud STT diagnostic scoring"
```

## Task 3: 参数化单次 QCloud 到 renderer 采样运行器

**Files:**
- Modify: `scripts/run-sales-local-stt-benchmark.mjs`
- Modify: `scripts/benchmark-qcloud-stt-renderer.mjs`
- Create: `scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs`

**Acceptance:** 单次运行可显式设置 segment、poll、parameter-group 和 VAD 变体；输出阶段耗时、请求次数、质量判定和 renderer 耗时；默认参数仍与当前运行器一致。

- [ ] **Step 1: 编写 CLI 与样本格式失败测试**

把参数解析和样本组装导出为纯函数，测试：

```bash
--segment-seconds 10
--poll-interval-ms 1000
--parameter-group qcloud-current
--valid-samples 10
--output /tmp/qcloud-cell.json
```

断言非法 segment、poll、parameter-group 和样本数会快速失败，且错误只给稳定参数码。

- [ ] **Step 2: 运行测试并确认红灯**

Run: `node --test scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs`

Expected: FAIL，当前运行器参数固定且没有所需导出。

- [ ] **Step 3: 将阶段观察器贯通到 QCloud 调用**

扩展 `transcribeClipWithQcloud()` 接收 `pollIntervalMs`、`parameterGroup`、`onPhase`，再传给 `transcribeNewApiDoubaoAucMultipartFile()`。保持未传参数时仍使用现有值。

- [ ] **Step 4: 参数化音频分段与 QCloud 参数组**

运行器支持 5/10/15 秒分段，支持 `qcloud-current` 与 `qcloud-current-plus-vad`。参数组映射复用现有 benchmark 定义，不能在多个文件各维护一份业务常量。

- [ ] **Step 5: 生成脱敏单元报告**

每个样本至少记录：

```json
{
  "valid": true,
  "segmentSeconds": 10,
  "pollIntervalMs": 1000,
  "parameterGroup": "qcloud-current",
  "pollRequests": 4,
  "qualityPassed": true,
  "timingsMs": {
    "submit": 120,
    "providerProcessing": 7200,
    "pollWait": 1000,
    "parse": 3,
    "submitToFinal": 8323,
    "finalToRenderer": 20,
    "endToEnd": 8343
  }
}
```

失败样本仅含 `valid: false`、参数与 `failureStage`，不得出现 Error 文本。

- [ ] **Step 6: 接入现有质量比较**

复用 `extractTimedTranscriptSegments()`、`selectReferenceWindow()`、`compareTranscripts()`。原始参考文本和识别文本仅在内存中比较；报告只写入长度、覆盖率或相似度等数值及 `qualityPassed`。

- [ ] **Step 7: 运行局部验证**

Run: `node --test scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs scripts/__tests__/qcloud-stt-diagnostics.test.mjs`

Expected: PASS。

Run: `node --check scripts/benchmark-qcloud-stt-renderer.mjs`

Expected: PASS。

- [ ] **Step 8: 自审并提交**

确认 diff 中没有 key、转录文本或响应体：

Run: `git diff --check -- scripts/run-sales-local-stt-benchmark.mjs scripts/benchmark-qcloud-stt-renderer.mjs scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs`

```bash
git add scripts/run-sales-local-stt-benchmark.mjs scripts/benchmark-qcloud-stt-renderer.mjs scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs
git commit -m "perf: parameterize QCloud STT renderer samples"
```

## Task 4: 实现可恢复的分阶段矩阵编排器

**Files:**
- Create: `scripts/run-qcloud-stt-diagnostics-matrix.mjs`
- Create: `scripts/__tests__/run-qcloud-stt-diagnostics-matrix.test.mjs`
- Modify: `package.json`

**Acceptance:** 编排器严格串行执行，已完成单元不会重跑，失败可继续补样；每阶段只推进合格胜者；每阶段胜者累计达到 30 个有效样本。

- [ ] **Step 1: 编写失败测试定义三阶段矩阵**

预期矩阵：

1. Poll：10 秒、`qcloud-current`，500/1000/2000ms，各 10 个有效样本。
2. Segment：采用 Poll 胜者，5/10/15 秒，各 10 个有效样本。
3. VAD：采用前两阶段胜者，`qcloud-current` 与 `qcloud-current-plus-vad`，各 10 个有效样本。
4. 每阶段胜者补跑至 30 个有效样本后才能写入最终胜者。

测试使用 fake runner，不调用 QCloud。

- [ ] **Step 2: 编写恢复与补样失败测试**

覆盖：

- 已有 7 有效 + 2 失败时只继续到 10 有效。
- 中断后读取 cell 文件续跑，不覆盖已存在样本。
- 子进程非零退出时记录阶段码并继续同一 cell 补样。
- 前一阶段无合格胜者时停止后续阶段，并报告 `blockedStage`。
- 同一时刻最多一个 runner 子进程。

- [ ] **Step 3: 运行测试并确认红灯**

Run: `node --test scripts/__tests__/run-qcloud-stt-diagnostics-matrix.test.mjs`

Expected: FAIL，编排器不存在。

- [ ] **Step 4: 实现串行编排器**

支持：

```bash
node scripts/run-qcloud-stt-diagnostics-matrix.mjs \
  --machine m4-16gb \
  --audio <fixture.wav> \
  --reference <timed-reference.json> \
  --output-dir reports/performance/m4-16gb/qcloud-stt-diagnostics
```

通过 `spawn` 调用单次运行器，显式传递参数；不通过拼接 shell 字符串执行。每次样本完成后原子写入 cell JSON，避免中断损坏。

- [ ] **Step 5: 输出阶段和最终聚合报告**

最终报告必须包含：

- 机器基准 `Apple M4 / 16GB`。
- 每个 cell 的参数、valid/failed、失败阶段计数、质量指标、请求数、各延迟 p50/p95。
- 每阶段胜者、选择证据和是否达到 30 个有效样本。
- 最终建议仅在所有阶段通过时出现。
- 任一阶段缺样或质量不合格时状态为 `blocked`，不得输出伪胜者。

- [ ] **Step 6: 增加 npm 命令**

在 `package.json` 添加一个清晰入口，例如：

```json
"perf:qcloud-stt-diagnostics": "node scripts/run-qcloud-stt-diagnostics-matrix.mjs"
```

- [ ] **Step 7: 运行自动化验证**

Run: `node --test scripts/__tests__/run-qcloud-stt-diagnostics-matrix.test.mjs scripts/__tests__/qcloud-stt-diagnostics.test.mjs scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs`

Expected: PASS。

Run: `node --check scripts/run-qcloud-stt-diagnostics-matrix.mjs`

Expected: PASS。

- [ ] **Step 8: 自审并提交**

Run: `git diff --check -- scripts/run-qcloud-stt-diagnostics-matrix.mjs scripts/__tests__/run-qcloud-stt-diagnostics-matrix.test.mjs package.json`

```bash
git add scripts/run-qcloud-stt-diagnostics-matrix.mjs scripts/__tests__/run-qcloud-stt-diagnostics-matrix.test.mjs package.json
git commit -m "perf: orchestrate QCloud STT diagnostic matrix"
```

## Task 5: 在 Apple M4 / 16GB 上执行真实矩阵并验收

**Files:**
- Generate: `reports/performance/m4-16gb/qcloud-stt-diagnostics/*.json`
- Verify: all files changed by Tasks 1-4

**Acceptance:** 所有矩阵单元有足够有效样本；每阶段胜者有 30 个有效样本；报告无敏感内容、无 blocked；结论能从报告数值直接复算。

- [ ] **Step 1: 前置检查**

确认当前分支：

Run: `git branch --show-current`

Expected: `ci/intel-mac-workflow`。

确认硬件：

Run: `system_profiler SPHardwareDataType`

Expected: Apple M4，内存 16GB。若不匹配，停止真实验收，不伪造机器标签。

确认 `.env` 中存在 QCloud 所需配置，但只检查键是否存在，绝不打印值。

- [ ] **Step 2: 先跑一个真实 smoke 样本**

使用 10 秒、2000ms、`qcloud-current` 跑 1 个有效样本。检查报告只含允许字段，renderer 有最终结果，质量通过。

- [ ] **Step 3: 执行完整矩阵**

Run: `npm run perf:qcloud-stt-diagnostics -- --machine m4-16gb --audio <fixture.wav> --reference <timed-reference.json> --output-dir reports/performance/m4-16gb/qcloud-stt-diagnostics`

Expected: 进程退出码 0；三阶段完成；阶段胜者均达到 30 个有效样本；最终报告状态 `completed`。

- [ ] **Step 4: 复核报告证据**

用独立脚本或 Node one-liner 复算每个 cell 的 valid 数、失败率、p50/p95 和胜者排序。复算值必须与报告一致。

检查报告无敏感字段：

```bash
rg -n 'api[_-]?key|authorization|transcript|audioData|responseBody|requestBody|task[_-]?id|Error:' reports/performance/m4-16gb/qcloud-stt-diagnostics
```

Expected: 无匹配。

- [ ] **Step 5: 运行最终回归验证**

Run: `node --test electron/audio/__tests__/DoubaoAucClientPhases.test.mjs scripts/__tests__/qcloud-stt-diagnostics.test.mjs scripts/__tests__/benchmark-qcloud-stt-renderer.test.mjs scripts/__tests__/run-qcloud-stt-diagnostics-matrix.test.mjs`

Expected: PASS。

Run: `npm run typecheck:electron`

Expected: PASS。

Run: `git diff --check`

Expected: PASS。

- [ ] **Step 6: 最终验收门槛（不可跳过）**

以下条件必须全部满足，否则结论只能是“未完成”：

1. Poll、Segment、VAD 三阶段所有候选各有至少 10 个有效样本。
2. 每阶段胜者各有 30 个有效样本，且质量门槛通过。
3. 最终报告包含所有关键延迟的 p50/p95、失败率、请求数和选择证据，状态不是 `blocked`。
4. 报告不含凭据、原始音频、原始转录、请求/响应体、task id 或未经脱敏的异常文本。
5. 自动化测试、Electron 类型检查和报告独立复算全部通过。

- [ ] **Step 7: 提交最终代码状态**

先检查提交范围，不提交忽略的本地报告或 `.env`：

Run: `git status --short`

若 Tasks 1-4 均已按任务提交且没有遗漏代码，则无需制造空提交；只记录最终验证命令和报告绝对路径。

## Completion Definition

本计划只有在 Task 5 的五项不可跳过门槛全部通过后才算完成。若真实 QCloud、固定基准机、音频 fixture 或参考文本不可用，必须明确标记对应阶段 `blocked`，不得以 mock、历史报告或不足样本替代最终验收。
