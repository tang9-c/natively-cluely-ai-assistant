# CueUp 产品力路线图：把实时会议动作卡片打穿

更新时间：2026-07-10

## 一句话判断

未来 3 个月，CueUp 不应该继续把主线写成“接更多上下文源”。也不能只写成“动作卡片更聪明”。

最先要守住的是可靠性：同一套功能在 macOS arm64、macOS x64、Windows x64 上都能启动、录音、转写、降级和恢复。尤其是 Local SenseVoice、Local Whisper、native audio、sqlite-vec、better-sqlite3、sherpa-onnx-node 这些 native/ONNX 路径。这里出问题，用户不会觉得“某个 provider 有 bug”。用户只会觉得软件不可靠。

主线应该变成：在销售、FDE、团队会议这 3 类高频会议里，CueUp 能在关键瞬间自动浮出一张小卡片，告诉用户现在该做什么、为什么、点一下能生成什么，并且这张卡片大多数时候是对的。

现在的问题不是“好像能用”。是“用户敢不敢在真实会议里依赖它”。

这就是产品力。

## 北极星

第一北极星：安装后的 CueUp 在目标 OS 上稳定完成一次真实会议闭环。

```text
安装 / 升级
  -> 启动
  -> 权限检查
  -> 本地/云端 STT 可用性检查
  -> 开始会议
  -> 产生 final transcript
  -> 触发回答/动作
  -> 保存会议
  -> 可解释降级
```

任一环节因为 OS、CPU 架构、native ABI、模型文件、权限、音频设备、打包路径不同而静默失败，都是 P0。

第二北极星才是产品力：

会议中 2 秒内出现一张可信、可操作、可忽略的实时提醒卡片，帮助用户赢下这一轮对话。

不是给用户更多信息。是帮用户少错过关键瞬间：

- 客户说太贵时，不是总结“客户提到价格”，而是给出可说出口的价值回应。
- 客户问 PLM / QMS / 企业 AI Agent 部署时，不是泛泛解释集成，而是追问业务流程、系统边界、数据对象、权限、验证步骤和上线责任人。
- 团队说“我来跟进”时，不是会后才发现，而是当场锁定负责人、交付物和时间。

如果卡片做不到“这一下帮我省了脑子”，它就只是 UI 动效。

## 当前代码库校验基线

本次路线图按当前代码库和最近提交重新校验，基线如下：

- HEAD：`78ece514 test: align audio fallback notice copy`。
- 近期主线提交已经覆盖动态动作音频回放、FDE 真实 STT 回放入口、招聘动态动作回放、QCLOUD 模型选择 IPC contract、音频降级提示文案、FDE 默认上下文迁移、RAG/STT 状态稳定和设置/session 中文化。
- `package.json` 已有 `test:quality:smoke`、`test:quality:diagnostics`、`test:quality:gate`、`test:dynamic-actions:product`、`test:dynamic-actions:replay`、`test:dynamic-actions:fde-replay:real-stt`、`test:dynamic-actions:recruiting-replay:real-stt`、`test:dynamic-actions:metrics`。
- 当前工作区还有未提交的质量工程补强：覆盖率脚本入口、DatabaseManager/LLMHelper/audio/STT/vision/profile/material 等测试扩展，以及 `test-reports/` 本地全量测试报告。
- `test-reports/SUMMARY.md` 显示：`typecheck:electron` 和 `build:electron` 通过，E2E 10 通过 2 skip，dynamic-actions replay 通过；此前 Settings 音频 fallback 文案同步失败已在 `78ece514` 修复。FDE 真实 STT replay 仍依赖 live key；招聘真实 STT replay 已有 3 条通过样例。
- 代码图谱显示本地 STT/native 相关路径影响半径很大：`LocalSenseVoiceSTT`、`LocalWhisperSTT`、`sttRegistry`、native module、`sherpa-onnx-node`、`onnxruntime-node`、`better-sqlite3`、`sqlite-vec` 会影响音频、RAG、会议保存、打包和启动。

工程判断：路线图可以继续把“动作卡片打穿”作为主线，但下一步不应该再写成搭地基。现在的短板是产品验收、真实会议回放、指标面板和测试门禁收口。Wild，但这是好事，地基终于开始够厚了。

更严格的工程判断：动作卡片主线必须排在可靠性门禁之后。跨 OS 本地 STT 不能稳定运行时，所有上层智能都是空中楼阁。

## 当前真相

工程地基已经不少：

- `DynamicActionEngine.assessSignals()` 已有 regex 候选、语义门控、云端仲裁、本地 fallback、reject/defer trace。
- `DynamicActionBar` / `DynamicActionCard` 已能展示、忽略、Tab 接受、5 秒自动生成，并已有用户可见 trust explanation contract。
- `ModesManager` 已有销售、FDE、团队会议等重点模式。
- `DynamicActionDetector` 已有 sales、fde、team-meet trigger packs。
- `IntentClassifier` 已有 mode-aware intent 和 answer shape。
- `RealtimeContextOrchestrator`、RAG、PPTX 诊断路径、Windchill 知识源、speaker policy、QCLOUD 情绪元数据都已进入上下文系统。
- `test:quality:smoke`、`test:quality:diagnostics`、`test:quality:gate` 已经存在，动态动作 product/replay/metrics 命令也已建立。
- FDE 默认上下文已经迁移到制造业 PLM / QMS / 企业 AI Agent 部署副驾驶定位。
- Local SenseVoice 已有模型可用性、生命周期、语言回退、情绪元数据和 final term correction 测试；术语纠错仍是后处理，不是解码热词偏置。
- 资料/RAG 已覆盖 PDF、DOCX、Markdown、TXT 和 PPTX 边界，PPTX 走 QCLOUD API 相关链路与诊断，不再把不支持态伪装成已解析。
- 业务系统、资料、屏幕、说话人、provider scope、实时答案 trace 已进入诊断和质量 smoke。
- 全量测试 runner 已经从 shell `&&` 链改成脚本化阶段报告，能看到后续阶段真实状态。

但产品还没有打穿。

现在更像“信号链路和验收骨架存在”，不是“用户在真实会议里离不开”。卡片还缺 5 件事：

1. 每个重点模式的关键时刻定义不够产品化。
2. 卡片接受后的回答质量还没有按模式形成强验收。
3. 误报、漏报、延迟、接受率没有变成产品指标面板。
4. 真实会议回放还不够，尤其是中文、英文、中英混合、多人说话、旧话题污染、ASR 错词、客户/内部成员区分。
5. 全量测试仍有零星测试/文案滞后，真实 STT replay 依赖 live key，不能算上线级闭环。

这就是未来 3 个月的工作。

## P0：跨 OS 本地 STT 与安装包可靠性

状态：必须提升为所有产品力工作的前置门禁。当前已有不少保护，但还不是发布级可靠性闭环。

### 已经存在

- `nativeModuleLoader.ts` 会按 `process.platform/process.arch` 加载 `index.darwin-arm64.node`、`index.darwin-x64.node`、`index.win32-x64-msvc.node`，并做 `getInputDevices()` 功能 smoke，避免只加载到 asar stub。
- `ensure-native-artifact.js` 会在开发启动前检查当前 OS/CPU 对应 native audio artifact。
- `build-native.js` 支持 macOS 显式 target：`x86_64-apple-darwin`、`aarch64-apple-darwin`，Windows 走 `x86_64-pc-windows-msvc`。
- `postinstall.js` 会 rebuild `better-sqlite3,keytar,sherpa-onnx-node`，并在 macOS 补 `ensure-sherpa-onnx-darwin.js`。
- `ensure-sqlite-vec.js` 会补 macOS arm64/x64 和 Windows x64 的 sqlite-vec platform package。
- `.github/workflows/build-arm64-mac.yml`、`build-intel-mac.yml`、`build-windows-x64.yml` 已能分别产出目标平台安装包。
- `MacX64NativeSmoke.test.mjs` 和 `WindowsPackagingSmoke.test.mjs` 已覆盖一部分打包配置、native artifact、sqlite-vec、postinstall 和 workflow 假设。
- `LocalSenseVoiceSTT.test.mjs` 已覆盖 fake worker 下的生命周期、drain、情绪 metadata、术语后处理、worker error/exit。

这些是好基础，但还不够。

### 真正缺的

```text
CI build smoke
  |
  +-- macOS arm64 artifact exists
  +-- macOS x64 artifact exists
  +-- Windows x64 artifact exists
  |
  v
Packaged runtime smoke
  |
  +-- app launches
  +-- native audio module loads real .node
  +-- sqlite-vec load path works or degrades explicitly
  +-- Local SenseVoice worker can require sherpa-onnx-node
  +-- model missing shows clear "download model" state
  +-- model present can run one tiny fixture or preflight
  +-- Local Whisper missing/present states are explicit
  |
  v
Meeting smoke
  |
  +-- microphone-only meeting can start
  +-- system audio permission denial is non-fatal
  +-- final transcript reaches renderer
  +-- meeting save succeeds
```

当前测试多是源码级 contract 和 fake worker。它能防止我们写错配置，但不能证明用户下载的 `.dmg` 或 `.exe` 在目标机器上真的能跑本地 STT。

### P0 可靠性验收标准

1. **三平台构建可重复**：macOS arm64、macOS x64、Windows x64 的 CI 构建都必须执行 typecheck、build、native artifact smoke、packaging smoke、release size audit。
2. **本地 STT 预检可解释**：Local SenseVoice / Local Whisper 在模型未安装、native addon 缺失、ABI 不匹配、worker init 失败时，设置页和会议页必须显示明确原因，不能只是不出 transcript。
3. **packaged app smoke 必须存在**：安装包构建后至少运行一个无真实麦克风依赖的 packaged smoke，证明 app 能启动、IPC 可用、native module 可加载、SenseVoice worker import 可达。
4. **真实会议最小闭环**：每个平台至少保留一个可执行的 microphone-only smoke。无法在 CI 访问真实音频设备时，必须用平台 smoke + 人工验收 checklist 补齐，不许假装自动化覆盖。
5. **降级不是失败伪装**：Screen Recording 权限缺失、系统音频不可用、本地模型未安装、sqlite-vec 不可用，都必须进入可见 degraded reason。
6. **版本组合固定**：Electron、better-sqlite3、sherpa-onnx-node、onnxruntime-node、sqlite-vec 的兼容组合必须有测试护栏。升级 Electron 前先证明 native addon rebuild 通过。

### 推荐下一步

- 新增 `test:release:smoke`：只做跨平台发布前门禁，不塞产品 eval。
- 新增 packaged smoke 脚本，例如 `scripts/release-smoke.mjs`，由 mac/windows workflow 在打包后运行。
- 给 Local SenseVoice 增加 worker import preflight：不跑完整识别也要证明 `require('sherpa-onnx-node')` 和 `OfflineRecognizer` 构造路径能到达，失败时返回结构化错误。
- 给 Local Whisper 增加同等预检：模型目录、ONNX runtime、worker path、缺模型提示。
- 把 `test:all` 的当前红点先清零，再把 reliability smoke 纳入阶段报告。

### 不在 P0 范围

- 不做 Linux 发布可靠性，当前公开发布目标先是 macOS 和 Windows。
- 不做 Apple notarization 自动化，签名/公证是分发信任问题，和本地 STT runtime smoke 分开推进。
- 不要求 CI 真录麦克风或系统音频，CI 先证明 packaged runtime 和 native/model 预检，真实音频由 release checklist 或专用机器补齐。
- 不新增本地意图模型或新 STT 模型。

## 3 个月产品力目标

到 3 个月后，CueUp 应该达到这个状态：

```text
用户进入会议
  |
  v
选择 销售 / FDE / 团队会议
  |
  v
CueUp 监听当前 turn + 最近上下文 + 资料 + 屏幕 + 业务系统
  |
  v
只在高价值瞬间浮出动作卡片
  |
  +-- 用户接受：生成可直接说/发/记录的内容
  +-- 用户忽略：系统学习这类场景不要打扰
  +-- 系统不确定：不弹卡，只记录诊断
```

产品验收不是“卡片出现了”。

产品验收是：

- 用户觉得它在正确时间帮了忙。
- 用户愿意点。
- 点完的内容能直接用。
- 不该出现时它安静。
- 出错时能解释为什么。

## 五步路线图

### Step 1：定义动作卡片的产品契约

时间：第 1-2 周

状态：已完成 release-gate 级别收口。产品契约已经数据化，UI 已接入，七状态 lifecycle 指标、accepted output deterministic validation、artifact carryover 状态边界和 metrics 报告均已有自动化验收。

目标：先把“什么叫一张好卡片”钉死。否则后面只会继续堆 trigger。

动作卡片必须从“检测提示”升级为“会议里的下一步动作”。

每张卡片必须包含：

- **用户现在要做的事**：例如“回应价格异议”“锁定集成验证步骤”“确认负责人和截止时间”。
- **为什么现在弹**：一句人能看懂的解释，不暴露 prompt、原始 provider error 或内部 trace。
- **证据摘要**：最多一条短 evidence，不塞整段 transcript。
- **接受后会生成什么**：短回应、检查清单、邮件草稿、行动项、决策记录。
- **风险状态**：高置信自动倒计时、普通卡片、低置信静默诊断。
- **退出方式**：忽略、取消自动生成、过期消失。

卡片不能做：

- 不能只写“检测到行动项”。
- 不能把内部字段名暴露给用户。
- 不能因为情绪 alone 触发动作。
- 不能在无证据时装作有证据。
- 不能把用户已经忽略过的同类卡片反复弹出。

产品 DoD：

- 已完成：`DynamicActionCard` 已进入用户可见解释路径，动态动作 trust UX contract 已进入 quality smoke。
- 已完成：`DynamicActionEngine` 已输出 gate trace，reject/defer 不出卡但可诊断。
- 已完成：动态动作 product/replay/metrics 命令已建立。
- 已完成：卡片状态和产物类型已经从文案约定升级为明确数据契约：`DynamicActionProductContract`、`DynamicActionOutputType`、`DynamicActionRiskState`、`DynamicActionPayload.status` 已在 renderer/main 类型边界中定义。
- 已完成：`shown / accepted / auto_generated / dismissed / expired / generated_failed / completed` 已进入同一套 lifecycle 口径，diagnostics 和 telemetry/metrics 均可记录。
- 已完成：`expired` 有生产可调用路径记录，不再只停留在 store 状态。
- 已完成：`ActionArtifact` 已作为 accepted card 会后 carryover 的 transient 产物契约，包含 `outputType`、`structuredSummary`、`missingFields`、`groundedSources`、`generationStatus` 和独立的 `acceptTriggerSource`。`generationStatus` 保持 `completed | generated_failed | not_generated`，不混入 lifecycle 状态。
- 已完成：accepted card 后的生成内容已有 action-type 级别 deterministic evaluator，覆盖价格异议、报价邮件、案例证明、技术 checklist 和 buying signal 下一步。
- 后续优化：`test:dynamic-actions:product` 当前默认输出仍是全模式汇总分数；如要做运营面板，需要增加 mode-level score 输出。

复用现有能力：

- `DynamicActionBar.tsx`
- `DynamicActionCard.tsx`
- `DynamicActionEngine.ts`
- `SignalStateTracker.ts`
- `ContextQualityDiagnosticsCollector`
- `AnswerQualityMetrics`

不做：

- 不扩展通用 MCP。
- 不做复杂卡片设计系统。
- 不做新模式。

### Step 2：销售模式打穿

时间：第 3-5 周

状态：已完成 release-gate 级别收口。销售五类关键瞬间、50 条 sales fixture matrix、accepted output deterministic validation、资料/PPTX/business_context grounding mock contract 和五类 sales artifact 会后 carryover 均已有自动化验收。真实 LLM/RAG/PPTX/Windchill 仍作为 opt-in smoke，不进入默认 CI。

目标：销售模式先成为第一个“真实可卖”的样板。因为销售场景最容易验证价值，也最容易暴露误报。

销售模式只做 5 个关键瞬间：

1. 价格异议：客户说太贵、预算不够、要折扣。
2. 报价请求：客户要报价、proposal、商务条款。
3. 案例/证明请求：客户要类似客户、ROI、成功案例。
4. 技术/集成需求：客户问 API、SSO、安全、部署环境。
5. 购买/推进信号：客户说下一步、法务、合同、试点。

每个瞬间都要打穿 4 层：

```text
客户当前话术
  -> 是否应该弹卡
  -> 卡片上说什么
  -> 点卡后生成什么
  -> 会后记录/跟进如何落地
```

销售卡片的产品标准：

- 价格异议卡片生成的是“可说出口的回应”，不是价值点列表。
- 报价请求卡片生成 email draft，但不能编价格、客户名、合同条款。
- 案例请求必须优先用 RAG / PPTX / 上传资料，不允许编客户案例。
- 技术需求必须生成澄清 checklist，而不是直接承诺能力。
- 推进信号必须锁定 next step、owner、date、artifact。

销售模式必须用真实资料打穿：

- 上传 sales deck 或 case study，PPTX 目前必须走 QCLOUD API 支持路径并显示清楚诊断。
- 上传 FAQ / pricing policy / security note。
- 客户问案例时，卡片接受后的回答能引用资料。
- 客户问 Windchill/PLM 事实时，能走业务系统上下文，但失败时不编。

验收指标：

- 50 条销售会议 fixture，覆盖中文、英文、中英混合。
- 价格类误报率 < 10%。
- 明确高价值销售瞬间召回率 > 80%。
- 用户接受卡片后，80% 生成内容无需大改即可说出口或发出。
- 每个 sales action 都有 accepted、dismissed、generated_failed 指标。

核心测试：

```bash
rtk npm run test:quality:gate
rtk node --test electron/services/__tests__/DynamicActionEngine.test.mjs
rtk node --test electron/services/__tests__/IntelligenceEngineDynamicActions.test.mjs
```

新增测试方向：

- 已完成：`SalesDynamicActionProductFixtures.test.mjs` 已从 6 条代表样例升级为完整读取 `tests/fixtures/dynamic-actions/product/sales.json` 的 50 条 matrix，覆盖中文、英文、中英混合、内部/客户身份错位、旧话题污染和价格误报负样本。
- 已完成：销售 fixture matrix 门禁验证 sales recall >= 80%、sales false positive < 10%、positive fixture 的 actionType/outputType 全匹配。
- 已完成：`SalesDynamicActionAnswerQuality.test.mjs` 已验证销售 prompt / detector 约束，并接入 accepted output evaluator，覆盖报价不编价格/客户名/合同条款、案例不编 proof、价格异议不编折扣或 ROI。
- 已完成：`SalesActionCardUx.contract.test.mjs` 已存在，作为销售卡片 UX contract。
- 已完成：`SalesDynamicActionGrounding.test.mjs` 覆盖 material / pptx / business_context 的可用、未找到和失败场景；默认测试不依赖真实外部服务。
- 已完成：`PostCallWorkflow.test.mjs` 覆盖五类 sales accepted artifact carryover：价格异议回应、报价邮件、案例/证明回应、技术 checklist、buying signal action item。
- 后续优化：真实 provider smoke 可单独验证 LLM/RAG/PPTX/Windchill 端到端，但不作为默认 CI 门禁。

### Step 3：FDE 模式打穿

时间：第 6-8 周

状态：进行中，制造业 PLM / QMS / 企业 AI Agent 定位已经写入默认上下文，真实 STT replay 入口已建立。

目标：FDE 模式要从“通用客户现场部署助手”收敛成“制造业 PLM / QMS / 企业 AI Agent 部署助手”。

FDE 的用户价值不是回答所有技术问题。是让负责制造业研发与质量业务系统部署的前线工程师，把客户现场的流程、数据、权限、质量闭环和 AI Agent 落地风险收束成可执行交付计划。

这类 FDE 的默认画像要写进模式上下文：

- 熟悉制造业研发流程：物料、BOM、图纸、ECR / ECO / ECN、变更评审、发布、版本、权限。
- 熟悉质量流程：NCR、CAPA、8D、客诉、审计、检验、追溯、偏差、闭环验证。
- 熟悉企业 AI Agent 部署：知识源接入、权限边界、工具调用、审批流、人机协同、评测和上线治理。
- 不替客户做流程承诺，不替系统写入数据，不把未知的业务规则说成事实。

FDE 只做 6 个关键瞬间：

1. 业务流程发现：客户描述研发、变更、质量或审批现在怎么跑。
2. 系统对象澄清：客户提到物料、BOM、图纸、变更单、CAPA、NCR、审计或项目对象。
3. 集成与权限澄清：PLM、QMS、ERP、MES、文档系统、SSO、角色、数据方向、读写边界。
4. AI Agent 可行性判断：哪些动作适合 AI 建议，哪些必须人审，哪些只能只读查询。
5. 风险/合规/验证：权限越界、质量记录真实性、审计追踪、数据驻留、上线回滚、模型误判。
6. 下一步锁定：owner、deliverable、date、validation artifact、测试数据和验收标准。

FDE 卡片接受后不应该生成漂亮废话。

它应该生成：

- 3 个面向制造业流程的澄清问题。
- 一个最小验证步骤，例如“用一个真实 ECO 和一个 CAPA 样本跑通只读查询与审批建议”。
- 一个 owner/date/artifact checklist。
- 一个风险记录，区分业务流程风险、系统权限风险、AI Agent 误判风险。
- 一个验收标准草案，包含准确率、权限边界、人工确认点和审计可追溯性。

FDE 模式要支持“场景档案”和“自定义上下文”：

```text
场景档案
  -> 当前客户行业、工厂/研发/质量组织、已知系统、关键流程、上线阶段
  -> PLM / QMS / AI Agent 部署目标
  -> 本次会议要推进的验证对象和验收标准

自定义上下文
  -> 客户术语映射
  -> 业务对象命名规则
  -> 不可承诺事项
  -> 内部交付边界
  -> 已知风险和待验证假设
```

FDE 模式必须吃进这些上下文：

- 当前会议 transcript。
- 最近 6 轮上下文。
- 屏幕上下文，尤其是 PLM / QMS 页面、错误信息、对象详情、流程图、API 文档。
- PPTX 方案材料，尤其是部署方案、流程蓝图、AI Agent 架构和验收计划。
- Windchill / PLM 查询结果，限只读事实。
- QMS 或业务系统查询结果，限只读事实。
- 场景档案和用户自定义上下文。
- QCLOUD / SenseVoice 的说话人和情绪线索，只作辅助。

产品 DoD：

- 已完成：默认 FDE context 已迁移到制造业 PLM / QMS / 企业 AI Agent 部署副驾驶定位。
- 已完成：`test:dynamic-actions:fde-replay:real-stt` 已建立，缺 live key 时明确失败，不伪装通过。
- 已完成：FDE 动态动作已有制造业 fixture 覆盖基础。
- 仍需补齐：FDE 卡片按“制造业业务流程推进”组织，不按技术名词组织。
- 仍需补齐：卡片接受后的内容默认短、具体、可问出口。
- 仍需补齐：安全/合规卡片必须保守，不能承诺未经证实的质量、审计或权限能力。
- 仍需补齐：风险卡片必须区分“客户流程风险”“系统权限风险”“我们交付风险”“AI Agent 误判风险”“信息缺失”。
- 仍需补齐：下一步卡片缺 owner/date/artifact 时必须追问，不许脑补。
- AI Agent 卡片必须默认包含人工确认点，不能暗示系统会自动写入 PLM / QMS。
- 不是增加新功能,是把现有的功能利用好.

验收指标：

- 40 条 FDE 会议 fixture。
- PLM 流程、QMS 流程、AI Agent 可行性、权限/合规、风险/下一步 5 类高价值卡片召回率 > 75%。
- 明确无关技术闲聊误报率 < 10%。
- 接受后内容平均 < 120 words 或中文 < 180 字。
- 每个卡片都有“缺什么信息”的表达。
- 每个 AI Agent 部署建议都必须包含“人工确认点”和“不可自动化边界”。

新增测试方向：

- `FdeDynamicActionProductFixtures.test.mjs`
- `FdeActionAnswerShape.test.mjs`
- `FdeScreenAndMaterialContext.test.mjs`
- `FdeManufacturingScenarioProfile.test.mjs`

### Step 4：团队会议模式打穿

时间：第 9-10 周

状态：未开始产品打穿，仍以通用动态动作能力为主。

目标：团队会议模式不是“会后总结器”。它要在会中帮团队把口头承诺变成明确行动。

团队会议只做 4 个关键瞬间：

1. 行动项：谁做什么。
2. 截止时间：什么时候交。
3. 决策：已经决定了什么，谁同意。
4. 阻塞：卡在哪里，下一步怎么解。

团队会议卡片产品标准：

- 行动项卡片必须抽取 owner、deliverable、due date。缺任何一项，卡片应提示“还缺负责人/截止时间”。
- 决策卡片必须记录 decision、rationale、reversibility。不能把讨论中的选项误写成决定。
- 阻塞卡片必须记录 blocker、impact、dependency、next unblock step。
- 内部成员说“我们的报价表在这”不能触发销售报价动作。模式隔离必须继续硬。

会中和会后必须闭环：

```text
会中卡片捕捉
  -> 用户接受/修正
  -> 进入会议 notes 对应 section
  -> 会后 summary 使用同一结构
  -> 用户可复制行动项
```

产品 DoD：

- Team Meeting 的卡片接受后，不只生成回答，也能形成结构化 note draft。
- Action item / decision / blocker 三类数据进入同一后处理路径。
- 会后 summary 能引用会中接受的卡片。
- 用户忽略卡片后，同类候选短时间内降噪。

验收指标：

- 30 条团队会议 fixture。
- 明确行动项召回率 > 85%。
- action item 三字段完整率 > 70%。
- 决策误报率 < 10%。
- 会后 summary 中 accepted card 的保留率 > 90%。

新增测试方向：

- `TeamMeetingDynamicActionProductFixtures.test.mjs`
- `TeamMeetingActionItemCompleteness.test.mjs`
- `PostCallDynamicActionCarryover.test.mjs`

### Step 5：真实会议评测和产品运营闭环

时间：第 11-12 周

状态：基础命令已建立，质量工程正在扩展；产品运营面板未完成。

目标：把“基本能用”变成“持续变好”。

没有评测闭环，动作卡片会退化成 trigger 花园。今天加一个词，明天误报一个会。软件很快变成玄学。

需要建立 4 个面板：

1. 模式质量面板：sales / fde / team-meet 的 shown、accepted、dismissed、expired、generated_failed。
2. 误报/漏报面板：按 action type 看 precision、recall、defer rate、cloud fallback rate。
3. 延迟面板：从 final transcript 到 card shown、card accepted 到 first token。
4. 可信度面板：RAG hit、PPTX hit、Windchill hit、screen used、scope denied、local fallback。

评测资产：

- 120 条文本 fixture。
- 30 段真实录音回放。
- 15 个销售场景。
- 10 个 FDE 场景。
- 5 个团队会议场景。
- 中英混合、多说话人、旧话题污染、ASR 错词、内部/客户身份错位都必须有。

每周产品 QA：

```text
周一：跑 quality gate + fixture report
周二：人工看 10 段真实会议回放
周三：修 3 个最高频误报/漏报
周四：验证卡片接受后答案质量
周五：更新模式 playbook 和路线图
```

质量门禁：

```bash
rtk npm run test:quality:changed
rtk npm run test:quality:gate
rtk npm run test:quality:diagnostics
rtk npm run test:dynamic-actions:product
rtk npm run test:dynamic-actions:replay
rtk npm run test:dynamic-actions:metrics
```

已经建立但还需产品化使用的命令：

```bash
rtk npm run test:dynamic-actions:fde-replay:real-stt
rtk npm run test:dynamic-actions:recruiting-replay:real-stt
```

注意：真实 STT replay 依赖 `QCLOUD_LIVE_API_KEY` 或 `NATIVELY_API_KEY`，缺环境变量时必须标为环境 skip / blocked，不能当作通过。

3 个月结束时，不能只说“测试通过”。

要能说：

- 销售卡片在哪些场景有用。
- FDE 卡片在哪些场景有用。
- 团队会议卡片在哪些场景有用。
- 哪些卡片被用户忽略最多。
- 哪些卡片接受后生成失败最多。
- 哪些上下文源真的提升了卡片质量。

## 五步时间线

```text
第 1-2 周
  Step 1: 动作卡片产品契约
  输出：卡片状态、文案、产物类型、指标事件、UX contract test

第 3-5 周
  Step 2: 销售模式打穿
  输出：5 类销售关键瞬间、销售资料 grounding、销售 fixture 和答案质量验收

第 6-8 周
  Step 3: FDE 模式打穿
  输出：PLM / QMS / 企业 AI Agent 部署关键瞬间、场景档案、屏幕/PPTX/Windchill grounding、FDE fixture

第 9-10 周
  Step 4: 团队会议模式打穿
  输出：行动项/决策/阻塞闭环、会中卡片到会后 summary carryover

第 11-12 周
  Step 5: 真实会议评测和运营闭环
  输出：产品指标面板、录音回放评测、误报/漏报修复节奏
```

## 重点模式定义

### 销售模式

用户工作：赢下交易，推进下一步。

CueUp 要帮：

- 识别客户的真实购买信号。
- 处理价格、竞品、ROI、案例和技术风险。
- 用已有资料回答，不能编。
- 把下一步变成 owner/date/artifact。

不追求：

- CRM 写回。
- 自动发邮件。
- 自动生成正式报价。
- 编客户案例。

### FDE 模式

用户工作：把制造业客户的研发、质量和企业 AI Agent 部署讨论，从混乱现场推进到可验证、可上线、可审计的交付方案。

这个模式不再服务所有“客户现场工程师”。默认服务的是负责 PLM / QMS 系统部署和企业 AI Agent 部署的 FDE。他们理解制造业研发与质量流程，也理解前沿 AI 技术怎么安全落地到企业系统。

CueUp 要帮：

- 从客户话里抽取研发流程、质量流程、业务对象、系统边界、数据权限和交付风险。
- 在正确时机追问关键缺口。
- 把 PLM / QMS 集成、AI Agent 可行性、权限、风险、验收变成 checklist。
- 把会议结束前的下一步锁死。
- 通过场景档案和自定义上下文记住客户术语、系统清单、流程阶段、不可承诺事项和待验证假设。

不追求：

- 替工程师做架构承诺。
- 自动改客户系统。
- 写入 PLM/QMS。
- 泛泛回答所有技术问题。
- 泛泛服务所有行业的 FDE 场景。

### 团队会议模式

用户工作：让团队会议产生清楚的决定和行动。

CueUp 要帮：

- 捕捉行动项。
- 补齐 owner、deliverable、due date。
- 捕捉真实决策，不把讨论选项当决定。
- 捕捉阻塞和解法。
- 会后 summary 延续会中确认过的卡片。

不追求：

- 替团队管理项目工具。
- 复杂 OKR 系统。
- 写 Jira / Slack。
- 自动评价团队成员。

## 动作卡片体验标准

```text
错误体验：
  “检测到行动项 90%”
  用户：所以呢？

正确体验：
  “锁定负责人和截止时间”
  “刚才有人承诺会跟进，但还缺截止时间。”
  [生成一句追问] [忽略]
```

卡片要像一个好同事，少说，准，知道什么时候闭嘴。

### 卡片分级

| 等级 | 行为 | 适用 |
|------|------|------|
| P0 Auto Countdown | 5 秒后自动生成，可取消 | 高置信、低风险、强行动信号 |
| P1 Suggested Card | 显示卡片，用户点击生成 | 高价值但需要用户确认 |
| P2 Quiet Diagnostic | 不打扰用户，只记录 trace | 低置信、旧话题污染、scope denied |
| P3 Suppressed | 完全不出现 | 明确误报、用户刚忽略、无证据 |

### 卡片生成物

| 场景 | 产物 |
|------|------|
| 销售价格异议 | 可说出口的短回应 |
| 销售报价请求 | 带占位符的 email draft |
| 销售案例请求 | grounded proof points |
| FDE PLM/QMS 流程澄清 | 业务对象 + 流程缺口 + 下一验证步骤 |
| FDE 企业 AI Agent 可行性 | 可自动化边界 + 人工确认点 + 最小验证 |
| FDE 权限/合规评审 | 权限、审计、数据边界问题清单 |
| FDE 风险阻塞 | 业务流程/系统权限/AI 误判 blocker record |
| 团队行动项 | owner / deliverable / due date |
| 团队决策 | decision / rationale / reversibility |

## 指标

3 个月内要盯这些数：

| 指标 | 目标 | 为什么 |
|------|------|--------|
| Card shown latency | p95 < 2s after final transcript | 会中慢了就没用 |
| Accept rate | 目标模式 > 25% | 用户是否觉得卡片有价值 |
| Dismiss rate | 单 action type > 60% 要复盘 | 可能误报或文案不对 |
| Generated failure rate | < 3% | 点了没结果最伤信任 |
| Sales high-value recall | > 80% | 销售模式是否真的帮忙 |
| Sales pricing false positive | < 10% | 价格误报最烦 |
| FDE high-value recall | > 75% | FDE 是否真的能推进 PLM/QMS/AI Agent 部署 |
| Team action completeness | > 70% | 行动项是否可执行 |
| Accepted card carryover | > 90% | 会中动作是否进入会后产物 |

不要只看“卡片出现次数”。那是 vanity metric。

## 现有能力如何服务这条路线

| 能力 | 当前状态 | 未来 3 个月用法 |
|------|----------|----------------|
| DynamicActionEngine | 已有语义门控、trace、product/replay 基础测试 | 变成三大重点模式的核心产品引擎 |
| DynamicActionCard | 已能展示/接受/忽略，并已有 trust UX contract | 升级为稳定 action promise + evidence + output type 数据契约 |
| IntentClassifier | 已有 mode-aware intent | 用于模式关键瞬间召回和答案形状 |
| SignalStateTracker | 已有重复证据和冷却 | 用于降噪和用户忽略后的学习 |
| RAG / Materials | PDF/DOCX/MD/TXT 已有本地抽取，PPTX 走 QCLOUD API 支持路径和诊断 | 销售案例、FDE 部署方案、流程蓝图和验收材料 grounding |
| Windchill adapter | 专用只读 MCP 已在 | FDE 中 PLM 物料、BOM、变更、文档等只读事实补充 |
| Screen understanding | 已在实时路径，vision-first fallback chain 已有测试扩展 | FDE 看 PLM/QMS 页面、错误信息、流程图和 API 文档 |
| QCLOUD emotion | 已透传到 UI | 只作风险/语气辅助，不能单独触发动作 |
| Local SenseVoice | 已有本地中文优先、术语后处理、模型缓存/生命周期测试 | 改善中文会议转写稳定性，但不承诺解码期热词偏置 |
| Scenario/Profile context | 已有场景档案、master profile 和模式资料过滤测试扩展 | 给销售/FDE 卡片提供可引用、可解释的个性化上下文 |
| Quality gate | 已有基础命令、动态动作 replay 命令和本地测试报告 | 扩成产品级 fixture、replay、coverage 和上线门禁 |

## 不在未来 3 个月范围内

- 通用 MCP marketplace。
- 写回 CRM、Jira、Slack、email。
- 写回 PLM/QMS。
- 大型 custom mode builder。
- 所有模式平均推进。
- 长期记忆 V1。
- 完整 provider marketplace。

这些不是不重要。只是现在会稀释主线。

先把 3 个重点模式打穿。打穿一个，胜过“基本支持八个”。

## 风险和反制

### 风险 1：卡片变成弹窗噪音

反制：

- P0/P1/P2/P3 分级。
- 用户忽略后进入 cooldown。
- 高风险动作必须语义门控。
- 每周看 dismiss rate 最高的 action type。

### 风险 2：模式看起来多，但每个都浅

反制：

- 未来 3 个月只把 sales、fde、team-meet 当主线。
- general / recruiting / lecture / technical-interview 保持维护，不做主战场。
- FDE 不再做泛行业现场工程师，主战场收敛到制造业 PLM / QMS / 企业 AI Agent 部署。
- 每个模式只选 4-6 个关键瞬间。

### 风险 3：生成内容不能直接用

反制：

- 每个 action type 有固定 output contract。
- fixture 不只断言 action 出现，还断言接受后 answer shape。
- 对 email draft、checklist、action item 分别验收。

### 风险 4：上下文源很多，但没人知道有没有用

反制：

- 每张卡片记录用了哪些上下文源。
- RAG/PPTX/Windchill/screen 命中进入 metrics。
- 用户文案只说来源状态，不暴露内部 trace。

### 风险 5：为了智能感牺牲信任

反制：

- 没证据就不说。
- 不确定就不弹。
- scope denied 是隐私生效，不是错误。
- provider 失败时本地降级，但不伪装成云端成功。

## 3 个月后的判断标准

这条路线成功，不是因为功能列表变长。

成功是用户会说：

- “销售电话里它能提醒我怎么接价格异议。”
- “客户问技术细节时，它能帮我把问题问完整。”
- “团队会议里它能抓住谁负责什么。”
- “它不会乱弹。”
- “它引用资料时我知道它用了什么。”

如果 3 个月后我们只能说“支持更多知识源、更多模式、更多 provider”，那就是走偏了。

## 推荐执行顺序

```text
1. 动作卡片产品契约
   先定义好卡片是什么，不是什么。

2. 销售模式打穿
   用价格、报价、案例、技术需求、推进信号证明价值。

3. FDE 模式打穿
   用 PLM/QMS 流程、业务对象、AI Agent 可行性、权限合规、风险和验收证明复杂会议价值。

4. 团队会议模式打穿
   用行动项、决策、阻塞和会后 carryover 证明日常价值。

5. 真实会议评测闭环
   用指标和回放防止产品退化成 trigger 堆。
```

## 下一冲刺执行队列

按当前代码库状态，下一冲刺不要再扩 provider、知识源或新模式。先收这 7 件事：

1. **建立 release reliability gate**：新增 `test:release:smoke` 或等价命令，覆盖 macOS arm64、macOS x64、Windows x64 的 packaged runtime smoke、native module load、sqlite-vec path、Local SenseVoice worker import preflight、Local Whisper preflight。
2. **修掉当前测试红点**：`SettingsAudioFallbackNotice.test.mjs` 与 `SettingsOverlay.tsx` 中文文案不同步。上线级路线图不能容忍“已知 1 红”被忽略。
3. **把本地 STT 降级做成用户可见状态**：模型未安装、native addon 缺失、ABI 不匹配、worker init 失败、权限不足，都要有设置页/会议页可读原因。
4. **把动态动作验收从出现推进到可用**：销售/FDE 至少各补一组 accepted output fixture，验证点击卡片后生成内容能直接说、能引用资料、不编价格/案例/PLM/QMS 事实。
5. **把真实 STT replay 纳入可选 CI**：`test:dynamic-actions:fde-replay:real-stt` 和 recruiting replay 已有入口，CI 需要有 live key 时跑，无 live key 时明确标记环境 skip。
6. **补产品指标面板第一版**：先显示 answer latency、citation hit rate、RAG hit rate、accept/dismiss/generated failure、degraded reason 分布。内部诊断已有，差的是用户/开发者可读出口。
7. **把 coverage 变成门禁而不是脚本摆设**：未提交工作区已有 `test:coverage*` 脚本入口，下一步要确定 baseline、diff threshold 和哪些目录先进入阈值。先从 `electron/services`、`electron/llm`、`electron/db`、`electron/audio` 这四块开始，不要一口吃全仓库。

当前不建议做：

- 不新增模式。
- 不新增业务系统写回。
- 不新增大 dashboard。
- 不把 SenseVoice 术语纠错说成“模型提前知道热词”。
- 不把没有 live key 跑过的 replay 写成已验收。
- 不把只在源码测试中 import 成功的本地 STT 写成“安装包可靠”。

## 战略总结

CueUp 的短期产品力不来自“什么都能接一点”。

来自一个非常窄但很硬的承诺：

在真实会议的关键时刻，CueUp 会给你一张对的卡片。

它不抢话，不乱弹，不编事实。它知道现在是什么模式，知道谁在说话，知道哪些资料可用，知道什么时候该闭嘴。

这才是从“AI 会议助手”变成“会议副驾驶”。
