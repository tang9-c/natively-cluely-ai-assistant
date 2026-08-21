# 统一性能基线编排器设计

## 目标

新增统一命令 `npm run perf:baseline:all`，将已有性能采样器组织成一个可恢复、可验证、可追溯的验收流程。命令负责环境检查、样本复用或采集、报告聚合、独立复算、隐私检查和退出状态，不重写各指标的测量逻辑。

完整模式的成功标准是 Apple M4 / 16GB 基准机上所有必需指标都有满足数量要求的有效样本、p50/p95，且没有 `blocked`、复算差异或隐私违规。快速模式只证明编排和采样链路可运行，不能替代正式基线。

## 非目标

- 不把多个采样器改造成单个大型测试文件。
- 不改变各性能指标的阈值或现有统计口径。
- 不把 QCloud AUC 强制改成流式 STT。
- 不并发执行真实 QCloud 请求。
- 不在统一命令中记录凭据、原始音频、原始转录、请求体、响应体或异常正文。
- 不因任意 Git 提交而强制重跑全部高成本样本。

## 命令接口

### 完整模式

```bash
npm run perf:baseline:all
```

完整模式检查目标机器和所有必需场景。对于结构、机器信息、样本数和统计值均有效的现有报告，直接复用；仅运行缺失或无效场景。它会生成正式的 `unified-final.json` 和 `unified-final.md`，并以最终验收结果决定退出码。

复用历史报告只表示这些样本仍满足验收输入要求，不表示本次重新执行了底层采样。统一报告必须记录每个场景的来源状态 `reused`、`collected` 或 `resumed`，避免把复用误报为新实测。

### 断点续跑

```bash
npm run perf:baseline:all -- --resume
```

`--resume` 允许从未达到目标数量的部分报告继续补样：

- 对支持逐样本输出的采样器，计算 `目标数 - 有效样本数`，将新增样本写入临时报告，校验和脱敏后与原样本合并，再原子替换正式报告。
- 合并时按稳定样本 ID 去重；旧报告没有 ID 时，以场景定义的稳定字段生成内容哈希作为 ID。
- 对 30/60 分钟长会议这类单次整体采样，不合并半次运行。已有完整报告则复用，缺失或无效则从头重跑对应时长。
- 不带 `--resume` 时，完整但有效的报告仍可复用；部分报告按场景整体重采，避免默认行为隐式拼接不同批次。

### 快速模式

```bash
npm run perf:baseline:all -- --quick
```

快速模式将逐样本场景的目标数降为 1，跳过 30/60 分钟长会议，不覆盖正式报告，输出：

```text
reports/performance/m4-16gb/unified-quick.json
reports/performance/m4-16gb/unified-quick.md
```

快速报告的顶层模式固定为 `quick`，状态只能是 `quick-completed` 或 `failed`。任何代码路径都不得把 `quick-completed` 解释为正式验收通过。

### 指定场景

```bash
npm run perf:baseline:all -- --only qcloud-stt,rag
```

`--only` 接受以下稳定场景 ID：

- `cold-start`
- `stt`
- `dynamic-action`
- `llm`
- `rag`
- `summary`
- `qcloud-stt`
- `long-meeting`

未知 ID、空列表或重复冲突参数直接失败。指定模式只执行并验收所选场景，输出 `unified-selected.json` 和 `unified-selected.md`，不得覆盖正式完整报告。`long-meeting` 同时包含 30 和 60 分钟报告。

`--quick` 可与 `--only` 组合，但选中 `long-meeting` 时仍跳过长会议并在报告中明确标记 `excluded-by-quick-mode`；该状态不是 `blocked`，但也不能形成正式验收结果。`--resume` 可与完整模式或 `--only` 组合。

## 场景清单

编排器使用声明式 manifest，将稳定场景 ID 映射到现有命令、样本目标和聚合器参数。

| 场景 ID | 采样器 | 正式目标 | 正式输入报告 | 聚合器参数 |
| --- | --- | ---: | --- | --- |
| `cold-start` | `scripts/benchmark-cold-start.mjs` | 30 | `reports/performance/m4-16gb/cold-start-30.json` | `--cold-start` |
| `stt` | `scripts/benchmark-stt-samples.mjs` | 30 | `reports/performance/m4-16gb/stt-30.json` | `--stt` |
| `dynamic-action` | `scripts/benchmark-qcloud-dynamic-action.mjs` | 30 | `reports/performance/m4-16gb/dynamic-action-30.json` | `--dynamic-action` |
| `llm` | `scripts/benchmark-qcloud-realtime.mjs` | 30 | `reports/performance/m4-16gb/qcloud-realtime-30.json` | `--qcloud-realtime` |
| `rag` | `scripts/benchmark-rag-query.mjs` | 30 | `reports/performance/m4-16gb/rag-30.jsonl` | `--rag` |
| `summary` | `scripts/benchmark-qcloud-summary-quality.mjs` | 30 | `reports/performance/m4-16gb/qcloud-summary-30.json` | `--qcloud-summary` |
| `qcloud-stt` | `scripts/benchmark-qcloud-stt-renderer.mjs` | 30 | `reports/performance/m4-16gb/qcloud-stt-renderer-final.json` | `--qcloud-stt-renderer` |
| `long-meeting` | `scripts/benchmark-long-meeting-memory.mjs` | 30/60 分钟各一次 | `release/long-meeting-memory-sensevoice-30m.json`、`release/long-meeting-memory-sensevoice-60m.json` | 两次 `--long-meeting` |

QCloud STT 诊断矩阵的 `reports/performance/m4-16gb/qcloud-stt-diagnostics/final.json` 用于参数选择证据，不替代统一聚合器需要的 renderer 链路报告。编排器不重复执行诊断矩阵。

## 报告有效性

编排器在决定复用前逐项验证报告，不仅检查文件是否存在：

1. 文件可按预期 JSON 或 JSONL 格式解析。
2. 报告声明的机器基线与 Apple M4 / 16GB 一致。
3. 样本结构满足该场景 schema，阶段码位于允许集合中。
4. 有效样本数量达到当前模式目标；失败样本不能计入有效样本。
5. 每个必需指标都有有限、非负的 p50/p95，且 p50 不大于 p95。
6. 从有效样本独立复算的样本数、p50 和 p95 与报告一致；浮点值只允许统一规定的舍入误差。
7. 报告中不存在 `blocked` 或验收失败。
8. 隐私扫描通过。

已有旧报告即使没有编排器 sidecar，只要通过上述内容校验即可首次复用。编排器随后记录 sidecar，包含 schema 版本、场景 ID、采样器路径及哈希、目标数、报告路径及哈希、运行模式和时间。后续仅在报告内容仍有效且采样器哈希一致时复用；采样器变化只使对应场景失效，不牵连无关场景。

sidecar 不以整个 Git HEAD 作为失效条件，避免文档或无关代码提交触发昂贵的全量重跑。

## 编排流程

1. 解析参数并拒绝未知或互相冲突的参数。
2. 检查 Node 版本、依赖、目标机器、必要输入和凭据是否存在；凭据只输出 `configured` 或 `missing`。
3. 加载 manifest，确定本次选中的场景和目标样本数。
4. 校验现有报告和 sidecar，形成 `reuse`、`resume`、`collect`、`excluded` 决策。
5. 对需要 Electron/Vite 的场景只构建 Electron 一次，并复用一个由编排器启动或探测到的 Vite 服务。
6. 严格串行运行采样器。子进程使用参数数组启动，不拼接 shell 命令；环境变量采用允许列表传递。
7. 每个采样器先写临时文件。编排器完成 schema、统计和隐私校验后再原子替换正式场景报告。
8. 调用现有 `scripts/run-performance-baseline.mjs` 生成统一 JSON/Markdown。
9. 使用独立验证模块重新读取底层样本，复算样本数、p50/p95、状态和隐私结果。
10. 原子写入最终报告和 sidecar，根据验收结果返回退出码。

若进程收到中断信号，停止当前子进程，保留已完成场景和有效临时样本，写入不含异常正文的阶段码。再次使用 `--resume` 时可继续补样。

## 机器与环境门槛

正式模式要求系统报告为 Apple Silicon M4 且物理内存约为 16GB。检测失败直接返回非零退出码，不产生正式通过报告。

快速模式和指定场景模式也执行机器检查，但允许通过显式测试专用依赖注入模拟机器信息；产品命令不提供绕过参数。自动化单元测试不得依赖开发机型号。

真实提供方场景在执行前检查所需配置。缺少配置时记录稳定阶段码，例如 `preflight_credentials_missing`，不得包含变量值、请求地址中的敏感参数或底层异常正文。

## 状态与失败语义

每个场景记录：

- `scenarioId`
- `decision`: `reused`、`collected`、`resumed`、`excluded`
- `status`: `completed`、`failed`、`blocked`、`excluded-by-quick-mode`
- `sampleTarget`
- `validSamples`
- `reportPath`
- `stageCode`

完整模式只有所有必需场景为 `completed` 且独立复算和隐私检查通过时退出 `0`。以下任一情况退出非零：缺样、解析失败、采样失败、`blocked`、统计不一致、机器不符、凭据缺失或隐私违规。

失败输出只列场景、稳定阶段码和报告路径。底层 `Error.message`、stdout/stderr 中可能包含的数据和凭据不得写入报告。

## 隐私检查

隐私扫描覆盖统一报告、场景报告和 sidecar，至少拒绝：

- 已配置凭据的明文值及常见 API key/JWT 模式。
- 原始音频或 base64 音频字段。
- 原始转录、prompt、请求体、响应体和动态动作 evidence。
- 未归类的异常正文和堆栈。

允许的失败信息只有预定义阶段码、数值指标、布尔状态和脱敏元数据。发现违规时不发布新的最终报告，并返回非零退出码。

## 实现结构

新增 `scripts/run-all-performance-baselines.mjs` 作为 CLI 薄层，核心逻辑放在可测试模块中：

- 参数解析与模式选择。
- 场景 manifest。
- 报告校验和复用决策。
- 子进程编排及中断处理。
- 部分样本合并与原子写入。
- 最终报告独立验证和隐私扫描。

`package.json` 只新增：

```json
"perf:baseline:all": "node scripts/run-all-performance-baselines.mjs"
```

底层采样器只在无法接收目标数量、输出路径或续跑临时路径时做最小改动，不复制其业务逻辑。

## 测试方案

自动化测试通过依赖注入的虚拟 manifest、临时目录和假子进程验证，不发起真实付费请求，也不运行 30/60 分钟会议：

1. 完整模式按依赖顺序串行执行缺失场景并聚合报告。
2. 有效正式报告被复用，来源明确为 `reused`。
3. 无效、缺样、统计不一致或采样器哈希变化的报告会被重采。
4. `--resume` 只补足缺失数量，合并后无重复样本。
5. 默认模式不拼接部分报告，而是重采对应场景。
6. `--quick` 只采一个样本、跳过长会议且不覆盖正式报告。
7. `--only` 只运行指定场景，未知 ID 失败。
8. QCloud 场景严格串行，凭据值不进入命令输出或报告。
9. 中断保留已完成状态，续跑从缺口继续。
10. 任一 `blocked`、缺失 p50/p95、复算差异或隐私命中均返回非零。
11. 机器不符时正式模式在采样前失败。
12. 现有历史报告通过兼容校验后可复用并生成 sidecar。

实现完成后运行新增测试、现有聚合器测试、相关采样器测试和项目要求的类型检查。最后在目标机执行统一命令。仓库当前已有满足数量的正式报告时，首次完整执行应复用有效报告并完成聚合验证，不应为了证明编排器可用而重复产生付费调用；真实采样链路由快速模式或选定场景运行单独证明，并在报告中清楚标记其模式和来源。

## 完工标志

1. `package.json` 提供 `perf:baseline:all`。
2. 完整、快速、续跑和指定场景模式均有自动化测试且通过。
3. 编排器可调用现有采样器，支持安全中断、原子写入和串行真实请求。
4. 有效历史报告可复用，部分样本只在 `--resume` 下补足且不会重复。
5. 统一报告包含每个场景的来源、目标数、有效样本数、p50/p95 和稳定阶段码。
6. 任一缺样、`blocked`、统计不一致、机器不符或隐私违规均使命令失败。
7. Apple M4 / 16GB 目标机的完整统一报告不存在 `blocked`，所有必需指标均有有效样本及 p50/p95。
8. PRD 状态在上述条件全部满足后才改为“已完成”。
