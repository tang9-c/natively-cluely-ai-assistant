# 2.7.14 本地质量基线与外部验收缺口

日期：2026-10-16。开发基点 `bd2bc243`（v2.7.13）；执行分支 `codex/three-release-quality`。这是开发基线，不是 2.7.14 发版验收结论。用户选择先完成本地开发，外部验收单独记录。

## 环境与可复查入口

Apple M4 / 16 GB，macOS 26.1（25B78），Node v24.11.1、npm 11.6.2。隔离 worktree 使用原 checkout 的 node_modules 符号链接，未执行安装、依赖升级或 native rebuild；Electron 构建在隔离 worktree 内完成。SQLite 内存查询成功，sqlite-vec/sherpa require 成功不等于向量查询或模型推理通过。

详细本地日志位于该 worktree 的 `.superpowers/sdd/2026-10-16-three-release-quality-development/`，包括 A1-report、A1-review、A3-e2e、B-local-baseline、B3-modes、B3-quality-smoke、B3-product、B3-replay 和 local-readiness-report。该目录是临时执行证据，不提交原始日志。后续修复的红绿测试和独立评审见同目录 A2/B2 报告及版本控制提交。

## 已执行的开发基线

| 范围 | 结果 | 可证明内容/限制 |
|---|---:|---|
| A1 摘要行动项、更新、复制四文件 | 42 pass / 0 fail / 0 skip | 含 Chromium 真实剪贴板与拒绝/缺API；不含安装包更新网络观测 |
| 主进程及 Renderer 类型检查 | 均退出 0 | 静态检查；非真实设备验收 |
| Renderer Vite 构建 | 退出 0 | 产物生成；非视觉验收 |
| Electron E2E | 3 pass / 0 fail | 首击启动、长转写虚拟列表、菜单操作；跳过真实音频采集 |
| 术语/会后生成七文件基线 | 68 pass / 0 fail / 0 skip | 确定性行为/契约；不代表真实模型中文质量 |
| 模式测试 | 282 pass / 0 fail / 0 skip | 含既有模式/画像回归 |
| 质量 smoke | 396 pass / 0 fail / 0 skip | 既有离线行为、mock与contract混合，不宣称全部端到端 |
| 产品 fixture | 168 项，报告无契约失败 | fixture_oracle，不能当模型精确率/召回率 |
| 音频回放脚本 | 10 passed / 0 failed / 0 skipped | transcribeAudio返回文本fixture，未测真实STT |
| 性能工具离线测试 | 44 pass / 0 fail | 编排/采集/报告逻辑，未产生当前性能基线 |

每行独立报告，存在共享/嵌套测试，不将数字相加包装为独立场景总数。Playwright 运行出现 NO_COLOR/FORCE_COLOR 环境警告，不是测试失败，也不声称输出无警告。临时深色/键盘探索脚本未保留，不计入持久验收覆盖；产品 CSS、焦点对比度仍需真实渲染检查。

## 样本现状

| 模式 | 场景数 | 应触发 | 不应触发 |
|---|---:|---:|---:|
| FDE | 40 | 30 | 10 |
| Sales | 52 | 30 | 22 |
| Team-meet | 30 | 22 | 8 |
| Recruiting | 46 | 18 | 28 |

这些是场景，不是独立整场会议。未在核验范围找到 General product 集、会议级调优/留出拆分、hash去重、100明确承诺/100非行动/100动作正负例及人工复核的完整证据。现有合成音频不冒充客户会议。不得将本表当作冻结留出集或使用 oracle 输出计算真实质量指标。

## 尚未完成的验收

- A2 的50次完整生命周期矩阵和真实60分钟会议，不由源码顺序断言或重复单例代替。
- 会议级冻结样本、独立人工复核与摘要校订耗时；真实提供商质量、成本及失败率对照。
- 当前性能30样本及30/60分钟实测。8月历史报告不作为本次测量；统一脚本会复用旧文件，必须隔离归档并确认实际采集。
- `npm run ensure:native` 实测退出 1：缺 `native-module/index.darwin-arm64.node`，开发目录为 `/Library/Developer/CommandLineTools`，构建要求完整 Xcode。没有修改系统开发目录或安装工具；真实采集须先准备匹配产物，不能用 E2E_SKIP_AUDIO_START 冒充采集成功。
- macOS ARM64/Intel、Windows x64 安装包 runtime/native smoke、权限拒绝/设备断开、离线启动15秒更新接口观测、真实退出保存、回装和旧会议可读。实际发布 Linux 时也需要对应 smoke。

以上缺口保留为未验收，不标记任何版本已发布。外部样本、账号预算和设备负责人尚未落实，符合用户本轮仅先完成本地开发的选择。

## 已落地的本地修复

- `2af9a452`：placeholder 首写成功后才清理 session，DB 未初始化明确拒绝。真实 SQLite 触发器证明原行为失败；保留隐私不保存分支。
- `95006431`、`ca03c789`：保存失败保留原会议、共享显式重试，现有 Start 先保存再进入下一场；退出持久化屏障正在完成独立复审，不能以这些中间提交作为发版依据。
- `d33c5135`：缺少任一 chunk 结果则使用已有 failed 路径，防止部分会议摘要冒充完整成功；完整 chunks 的本地归并回退保留。四类失败先RED后GREEN，相关144项、模式282项、quality smoke396项通过，独立规格/质量审查通过。此处仍是确定性软件行为证明，不是真实模型质量分数。

完整10×5生命周期矩阵尚未完成；已增加的13个针对性行为案例不能替代该验收。相关测试/报告可能有嵌套和重复执行，禁止相加为独立用户场景数。

## 最终复核进展

`0fad800d` 完成退出启动门禁、首写等待与派生 RAG 取消；退出以可恢复转写为屏障，不等全部远端索引。dispose 后 live/初始化/后台 embedding 晚返回不再回写，队列 backoff 可取消；正常 Stop 仍 flush。相关176项与定向26项通过，A2复审及整分支审查通过本地范围，未发现新 Critical/Important。

首次完整 `npm test` 实测3132项：3125通过、7失败、0跳过。4项因真实QCLOUD密钥未提供，1项因隔离工作区缺ONNX发布资产，2项为全量并行期间MaterialRag P95越20ms。随后独立MaterialRag基准14/14通过；不将首次完整结果改写为通过，也不据此宣称检索提速。

补充检查发现原checkout已有ARM64原生模块及上述ONNX模型，已通过忽略的文件符号链接复用。`ensure:native`现在退出0、模块可加载、发布资产检查2/2通过；未安装Xcode或修改系统配置。前述预检失败是隔离工作区准备不足，现已补齐，不再作为当前构建资源缺失；真实采集/推理与包级验收仍未证明。

真实服务套件依用户选择保留外部验收。后续本地全集以显式离线文件清单串行运行，不能称为原始npm test全部通过。

最终显式离线串行全集：369个测试文件，排除3个*.live.test.mjs文件（共4个真实密钥测试），3128/3128通过、0失败、0跳过，耗时223.77秒。排除清单/完整命令保留在执行目录 offline-test-manifest.txt 与 final-offline-serial.log；不是修改测试逻辑或把未运行项记通过。原始npm test 3125/3132的7失败仍保留。质量gate（--base bd2bc243）退出0；最终Electron E2E3/3通过（23.0秒）。

## 当前候选冷启动实测

候选提交 `0fad800d`，上述 M4/16GB，复用原仓依赖/模型/原生模块，独立临时userData，Vite开发服务器。命令：`COLD_START_BENCHMARK_RUNS=30 node scripts/benchmark-cold-start.mjs reports/performance/quality-local-0fad800d/cold-start-30.json`，退出0；1次预热不计样本，30成功/0失败。按现有summarizeSamples的nearest-rank算法，p50=3664ms、p95=5569ms、min=2951ms、max=6330ms。

就绪边界为renderer_domcontentloaded_and_electron_api；E2E跳过真实音频启动，不代表首场采集、原生权限或生产安装包启动。没有同条件修改前对照，不能与8月报告直接计算收益，也不代表已达到2.7.16优化目标。原始报告受仓库reports/忽略规则保护，保留在本worktree，SHA-256：`152683f49a8e125e852e59cf3b4ec3947da3daa700e8c1b23aa97d2e533477b4`。

## 合成资源烟测的工具缺陷与修复

首次6秒合成会议+至少30秒T2恢复窗口的报告检查通过，但CLI退出1。已复现基准脚本finally在synthetic没有SenseVoice worker时，optional chaining得到undefined而`== null`仍为true，随后读取child崩溃。Electron已经关闭，后续server/临时目录清理被跳过，不能把这次计作命令完整通过。

`64a15d9a`只增加worker存在性判断，并在既有脚本测试中执行实际finally验证两种分支。修复前7通过/1失败，修复后相关13/13通过；未改变产品或性能阈值。首次报告归档为resource-smoke-before-cleanup-fix.json/md，重跑结果单独保存。

修复后的同一CLI重跑退出0，输出`0 acceptance failure(s)`；实际6秒synthetic会议加完整T2恢复窗口。T2 Main RSS=180961280bytes，恢复门槛379060224bytes；队列归零，转写单调检查通过。详情未打开，DOM行数不可用；VAD因绕过真实采集不可用，不能把报告的兼容PASS当作已测DOM/VAD。短时RSS斜率不外推长期趋势。本次不是30/60分钟、真实采集或完整退出E2E。原始报告SHA-256：`5fe3a7a0409d090121c6746f25640c3625a9bc0951e5a3533dd818cc31fdc138`。

最终本地提交截至`64a15d9a`，产品代码仍为`0fad800d`；工具补丁之后仅运行相关13项工具测试及真实CLI重跑，未无理由重复3128项产品测试。独立C3工具审查通过。工作区保留供复核，未推送、合并、升级版本或发布。
