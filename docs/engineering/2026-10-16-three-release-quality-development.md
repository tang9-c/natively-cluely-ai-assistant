# CueUp 2.7.14—2.7.16 质量优化开发方案

> **执行方式：**使用 superpowers:executing-plans 按任务实施、逐项验证；本文件不自动启动开发或并行代理。先读全局约束，再执行当前版本任务。

**Goal：**在现有功能范围内，依次改善会议流程可靠性、输出可信度、等待时间与长会议资源表现。

**Architecture：**沿用 Electron 主进程、React Renderer、原生采集、STT registry、ProviderRouter、SQLite 和现有会后/RAG/动态动作管线。修复发生在已证明有问题的最小公共路径；不新增业务服务、数据库结构或跨模块框架。

**Tech Stack：**现有 TypeScript、React、Electron、Rust、SQLite、Node test 与 Playwright；版本以 package.json/锁文件为准，不升级依赖作为本方案前置条件。

**Spec：**《未来三个版本质量路线图》，源文件 `/Users/tang-codeing/.gstack/projects/tang9-c-natively-cluely-ai-assistant/2026-10-16-three-release-quality-roadmap.md`。本方案已包含执行所需范围、顺序和门槛，源文件保留战略论证。

**依据：**2026-10-16，v2.7.13，HEAD `bd2bc243`。已核对图谱、关键实现、现有测试及脚本；本次没有运行产品测试、性能采样或打包。下面的风险不等同于已复现缺陷。

## 1. 全局约束与完成定义

- 不增加模式、提供商、用户入口、设置、自动重试机制或自动更新触发；不做全仓重构、依赖升级或视觉改版。
- 保留当前接口和存储格式。调整现有返回值或错误传播前核验所有调用方；确需 IPC 类型变化时同步 preload、renderer 声明和消费者。默认不新增 IPC。
- 不改变 provider 数据范围授权；日志/报告不含转写、提示词、材料正文、凭据或私人路径。使用既有脱敏工具。
- 不以降低转写完整度、删除上下文、关闭现有能力或隐藏失败样本换取性能。
- “已接收转写须保存”适用于允许持久化的有效会议；现有不足 1 秒忽略、meetingRetention=never、doNotPersist 与读取隐私设置失败时不保存的行为均纳入回归，不能被可靠性修复绕过。
- 50 次回放、冻结质量集、30/60 分钟测试是验收工作；不因此建设通用测试平台。能在已有测试文件补案例，就不增加脚手架。
- 每个缺陷任务：复现失败 → 确定调用链/数据边界 → 最小修改 → 对应回归 → 独立提交。未复现则记录覆盖结果并关闭核验，不为完成计划强行改代码。
- 本次只交付文档。下文复选框均是未来执行项；候选修改文件不是授权批量改动清单。

完成一版须同时有：提交清单、可复查的测试结果、当前版本报告、目标平台安装包证据和已知限制。开发通过、模拟通过、真机通过分开记录。

## 2. 任务依赖与范围预算

| 顺序 | 版本/任务 | 交付物 | 进入下一步的条件 |
|---|---|---|---|
| 1 | 2.7.14 / A1 已有修复验收 | 三个修复的回归证据 | 失败先修，不重复开发 |
| 2 | 2.7.14 / A2 生命周期与持久化 | 确定性行为测试、必要修复 | 隔离、保存、隐私不变量成立 |
| 3 | 2.7.14 / A3 交互与发布验证 | 现有 UI 状态和三架构安装包验收 | 60 分钟真实会议完成 |
| 4 | 2.7.14 / A4 冻结质量/性能起点 | 样本清单、基线、设备容量表 | 基线可复算；不把旧报告当新结果 |
| 5 | 2.7.15 / B1 转写与术语 | 有证据的归一化修复 | 不修改否定、金额、责任归属 |
| 6 | 2.7.15 / B2 会后输出 | 摘要、行动项的一致性修复 | 成功空结果、失败回退、长会覆盖正确 |
| 7 | 2.7.15 / B3 动作与资料边界 | 模式行为回归、必要根因修复 | 无跨会议/角色污染、资料不冒充事实 |
| 8 | 2.7.15 / B4 盲测与发布 | 冻结集评测、成本/延迟保护 | 质量门槛成立 |
| 9 | 2.7.16 / C1 热点确认 | 2.7.15 性能基线、最多两个首批热点 | 阶段证据能解释瓶颈 |
| 10 | 2.7.16 / C2 局部性能优化 | 每个热点一个可撤回改动 | 同负载配对测量有收益 |
| 11 | 2.7.16 / C3 长会与发布 | 30/60 分钟资源与全流程验收 | 第二版质量保持、安装包可用 |

顺序：A1→A2→A3；A4 的样本准备可与验收穿插，但质量/性能基线必须取 A2 完成后的固定提交。B1/B2/B3 各自只处理评测确认的问题，最后统一 B4。C1 必须基于 B4 的最终版本，不能沿用 8 月绝对值。

规划容量：第一版 3–5、第二版 5–8、第三版 5–8 个工程工作日，仅作排期参考。真实标注、设备排队和云端采样单列；发现数据丢失等高风险问题先修复再重估，不强行按日期发布。团队人数未知，不把人日换算成承诺日期。

## 3. 2.7.14：会议流程可靠

### A1：复核已有三项修复

**代码已完成：**`bbc7d2b5`（摘要行动项优先）、`99d39ad3`（复制反馈）、`bd2bc243`（取消启动自动检查更新）。本任务默认仅验证。

**文件：**electron/services/post-call/PostCallWorkflow.ts；src/components/MeetingDetails.tsx；electron/main.ts。

**测试：**electron/services/__tests__/PostCallWorkflow.test.mjs、AutoUpdateRuntimeContract.test.mjs、MacAutoUpdate.test.mjs；src/components/__tests__/MeetingDetailsFollowUpCopy.test.mjs。

- [ ] 按附录命令构建并运行现有测试，保留退出码与提交号。
- [ ] 成功摘要有行动项：下一步使用整理结果；成功摘要无行动项：不能重新从原始碎片补出；摘要失败：保留现有回退行为并显示失败状态，不声称结果已整理。
- [ ] 验证复制的真实剪贴板内容、成功提示、权限拒绝后重试、API 不可用；浅色/深色及键盘操作均检查。
- [ ] 安装包离线启动观察至少 15 秒，确认没有更新检查请求/错误窗；手动检查失败有反馈；退出不触发自动下载/安装。只统计更新接口，不能把其他已有网络请求混为更新。
- [ ] 有回归才修复并提交；否则将结果纳入 A3 发布报告。

**接口：**继续使用 `buildPostCallEnhancements(params)`、现有复制 handler 和更新 IPC，不增加包装层。

### A2：停止、保存、连续会议与退出

**核对链路：**main.ts `startMeeting/startMeetingInternal/endMeeting/drainSttFinalsForMeetingStop` → IntelligenceManager.ts `stopMeeting` → MeetingPersistence.ts `stopMeeting/processAndSaveMeeting/recoverUnprocessedMeetings` → DatabaseManager。

**代码事实与风险：**endMeeting 先更新 UI，再后台 drain、保存；所以 IPC 返回不证明保存完成。MeetingPersistence 先 snapshot/reset，写 placeholder 失败时 catch 后仍安排后台摘要并返回 ID。后者是应故障注入的风险，尚不能仅据此声称用户数据必然丢失。现有 MeetingPersistenceRace 测试只验证源码顺序。

**候选修改：**electron/main.ts、electron/MeetingPersistence.ts；只有调用契约确实受影响时才修改 IntelligenceManager、ipcHandlers 和 UI。相关 RAG 删除竞态在现有 RAG 文件修复，不能搬进主进程再实现一套。

**复用测试：**electron/__tests__/MeetingPersistence.test.mjs、MeetingPersistence.deep.test.mjs；electron/services/__tests__/MeetingPersistenceRace.test.mjs；electron/rag/__tests__/RAGManagerDeleteMeeting.test.mjs、RAGManagerLiveLifecycle.test.mjs、LiveRAGIndexerLifecycle.test.mjs。

- [ ] 使用临时 userData/数据库、可控 Promise 和 fake provider；复用当前测试的 mockElectron/session，避免真实用户库。确认实际执行的是修改后的构建，不用源码包含关系替代行为。
- [ ] 执行下表 10 类场景，每类覆盖 5 个有意义的调度/输入变体（共至少 50 次），记录断言和场景 ID；不能用同一 happy path 重跑 50 次冒充覆盖。
- [ ] 针对失败先确定责任边界：现有 teardown promise、会话标识、持久化成功点或删除防护；复用已有约束，只在缺口所在处补判断/等待/错误传播。
- [ ] 保存失败不得被展示为成功；仅在允许保存且确认首写成功后才清除唯一内存副本或依赖已有持久恢复路径。若现有行为不满足，以实际失败测试驱动调整顺序，不新增后台重试队列。
- [ ] 正常退出覆盖“停止后立刻退出”和“仍在录制时退出”。复用已有清理完成机制；保证允许保存的已接收 final 已落库，再完成退出。不为等待远端摘要无限阻塞退出；摘要可使用既有未处理会议恢复流程。
- [ ] 复跑行为测试和模式回归；逐缺陷提交。若无需修复，仅提交新增的有效行为测试。

| 场景 | 必须观察的结果 |
|---|---|
| 正常停止 / 尾部 final 到达 | drain 内收到的 final 属于 A 且允许保存时落库 |
| 快速重复开始 / 停止 | 不创建重复采集实例或重复有效会议 |
| A 停止、B 启动、A 的 STT/LLM 晚到 | B 数据不含 A；A 的合法后台摘要只能写 A |
| 上述响应先于停止的反序 | A 数据完整，B 保持独立 |
| 摘要超时、拒绝、坏 JSON | 转写保留；失败与无行动项区分 |
| placeholder 首写失败 / 后续摘要写入失败 | 不报告保存成功；禁止静默丢弃唯一快照 |
| never / doNotPersist / 隐私设置读取失败 | 无会议行、正文摘要或内容外发；保留现有允许的脱敏统计 |
| 空会议 / 不足 1 秒 | 遵守现有忽略规则，不制造假摘要 |
| embedding 返回与删除的两种顺序 | 删除提交后内容不复活，其他会议数据不受影响 |
| 正常退出时仍有保存/采集任务 | 清理有界、已接收可保存数据可重开读取、无更新检查 |

需要验证的调度模板（测试内部控制，不新增生产接口）：

```js
let release;
const blockedResult = new Promise(resolve => { release = resolve; });
// 在现有 fake provider 的返回点返回 blockedResult。
// A 发出请求后停止并启动 B，再 release(AResult)。
// 读取临时 DB 的 A/B 行与发出的窗口事件：B 不含 A，A 只写一次。
```

这里的 A/B 数据由现有测试工厂构造；具体 failing test 必须调用真实 stopMeeting/数据库路径。不能仅测试上面的 Promise 本身。

### A3：现有交互与安装包验收

**文件：**src/components/MeetingDetails.tsx、src/components/NativelyInterface.tsx、electron/WindowHelper.ts；tests/e2e/meeting-start-overlay-reliability.spec.ts、tests/e2e/fixtures.ts。只有复现缺陷才修改对应控件，不统一改全部页面。

- [ ] 启动按钮首击后状态一致；悬浮窗隐藏/恢复、切换会议后无旧卡片；复制失败可重试，空内容不出现误导操作。
- [ ] 摘要生成中、空结果、失败、成功四态分别验收；既有保存/模型下载入口检查相同状态问题。只修实际不一致项，不设计新状态系统。
- [ ] 权限拒绝、设备断开、网络断开/恢复、服务超时均使用现有错误出口；不得无限 loading、虚假成功或循环弹窗。
- [ ] 真实 60 分钟会议验收开始→采集→停止→保存→重开→复制→退出；音频回放/合成输入另记，不能替代真实采集。
- [ ] 复用 `.github/workflows/build-arm64-mac.yml`、`build-intel-mac.yml`、`build-windows-x64.yml` 的 runtime/native smoke；每架构记录包、系统、结果。Rosetta 单列，不能替代原生 ARM64。

**范围说明：**当前质量路线图的发布验收矩阵为 macOS ARM64、macOS Intel、Windows x64。package.json 还包含 Linux 构建目标；保留其行为，若本轮实际发布 Linux 包，必须另有该平台 smoke，不宣称已有三平台结果覆盖 Linux。

### A4：冻结基线与样本

**复用：**scripts/run-all-performance-baselines.mjs、scripts/lib/performanceBaselineOrchestrator.mjs、现有 QA runner、tests/fixtures/dynamic-actions/。

**新增文档（执行时创建）：**`docs/testing/quality-release-baseline-2.7.14.md`，集中记录下列数据，不另建管理系统：

- [ ] 提交号、OS/架构/内存、提供商/模型标识、负载 hash、采样时间、成功/失败分母、阶段边界、工具版本及 report 路径；不记录密钥或私有正文。
- [ ] 质量集按整场会议分割，FDE/Sales/General 每模式至少 10 场作为起点，其中至少 4 场用于调优、6 场冻结留出；每类覆盖中文、混说、长会、有行动/无行动。有效分母不足时增加留出会议，不复制句子凑数。其他现有模式保留既有回归。
- [ ] 留出集总计至少 100 个明确行动承诺、100 个非行动句、100 个动态动作正/负例；标注来源片段、明确责任人/日期、否定/取消、模式、正确触发与不应触发。动态动作正负例各至少 50 个，逐模式分别报告。
- [ ] 人工标注后独立复核关键字段和全部争议项；不能让同一生成模型既出答案又充当唯一评委。报告只存脱敏 ID/统计，原始敏感样本在获准测试存储中维护。
- [ ] 调优阶段不得看留出输出；按会议 hash 检查跨集重复，新增污染样本移出最终验收并补充未见样本。
- [ ] 确认真实调用的预算、测试账号及设备负责人后采样；当前只制定方案，不调用真实服务。

**重要工具限制：**统一性能脚本会复用有效旧报告，输出目录固定为 `reports/performance/m4-16gb`；`--resume` 不是强制重测，当前也无 `--force` 参数。新基线用独立测量 checkout，先完整归档已有样本再在隔离目录清空对应生成报告，确保日志显示本次采集而非 reused。绝不删除用户原报告。非 M4 平台使用已有单项脚本的可配置输出，按平台归档；不把不同硬件伪装为 M4。

**A4 出口：**当前基线和样本可复算；路线图中的 P1/P2 转为具体报告。P3 由执行时设备/人力表解决；缺设备的验收标记未完成。

## 4. 2.7.15：现有输出可信

### B1：转写和术语只做可证实纠正

**候选入口：**electron/audio/sensevoice/termCorrection.ts、defaultTermCorrections.ts、textCleaner.ts、sttRegistry.ts、SttQualityDiagnostics.ts；其他 provider 的归一化只在诊断证明问题位于该处时修改。

**测试：**electron/services/__tests__/LocalSenseVoiceTermCorrection.test.mjs、LocalSenseVoiceTextCleaner.test.mjs、SttRegistryLocalSenseVoice.test.mjs；使用现有 STT benchmark 和中文/混说音频样本。

- [ ] 先比较音频→原始 STT→归一化→最终文本，区分模型误听与后处理误替换。
- [ ] 为可重复误替换增加正例和相近词负例，再修改现有词典/规则；不将 SenseVoice 词典强行套到所有提供商。
- [ ] 检查 PLM/ERP/MES/Windchill 等必要术语；保留原话否定、金额、日期与人名，不猜测补齐。
- [ ] 使用同一音频、模型设置对照，逐提供商报告错误数；真实调用少量串行，确定性回归离线执行。

**验收：**被修复词例正确，新增负例不误伤；总体字错率仅作辅助，关键字段/否定句不得退化。没有确定规则可修的模型误听只记录限制，不新增翻译或二次 LLM 服务。

### B2：摘要、下一步与行动项一致

**候选文件：**electron/services/post-call/PostCallSummaryGenerator.ts、PostCallWorkflow.ts、PostCallLlmEnhancements.ts、electron/MeetingPersistence.ts。仅当提示组装缺陷在 LLMHelper 中才触达该文件。

**接口保持：**`generateFullTranscriptSummary(params): Promise<PostCallSummaryData>`；`generationStatus` 保持现有 success/failed；`buildPostCallEnhancements(params): PostCallEnhancements` 与 schemaVersion 保持兼容。

**测试：**PostCallSummaryGenerator.test.mjs、PostCallSummarySafety.test.mjs、PostCallWorkflow.test.mjs、PostCallDynamicActionCarryover.test.mjs、PostCallLlmEnhancements.test.mjs（均在 electron/services/__tests__/）。

- [ ] 在现有行为测试补齐下表，stub LLM 只证明解析/归并行为，不作为真实质量分数。
- [ ] 真实调优样本失败时先定位分块输入、归并 prompt、解析还是后处理；一次只修改出错环节，不叠加新的生成轮次。
- [ ] 成功摘要使用整理后的行动项；失败回退必须保留失败标识。对相同文本才能继承的 owner/deadline/timestamp 不扩大为无证据的模糊匹配。
- [ ] 长会头/中/尾与交界重复项全部回归；接受过的动态动作产物保留当前语义，取消/拒绝产物不能被补回。
- [ ] 将真模型结果交给 B4 留出集验收；失败应回到调优集，不在留出集逐题改提示词。

| 输入 | 必须输出/保留 |
|---|---|
| 中文会议夹英文 ASR 碎片 | 中文整理结果；合法缩写和必要引用可保留 |
| “不需要发送报价” | 不得生成发送报价行动 |
| “我周五发”；之后“取消发送” | 不得保留已取消承诺 |
| “建议以后考虑”，未承诺 | 不伪造负责人或截止日 |
| 成功生成 actionItems=[] | 明确无行动项，不回填原始碎片 |
| 拒绝/坏 JSON/空结构 | 失败状态，不伪装成功；转写不丢失 |
| 相同承诺跨 chunk 重复 | 合并去重，不丢关键限定条件 |
| 只有材料提到金额/日期 | 不冒充会议事实 |

可直接补进现有 PostCallWorkflow 测试的最小断言示例（先检查是否已有，禁止重复添加）：

```js
const result = buildPostCallEnhancements({
  transcript: [{ speaker: 'user', text: 'We will send a proposal.', timestamp: 1000 }],
  modeTemplateType: 'fde',
  summaryData: { generationStatus: 'success', actionItems: [] },
});
assert.deepEqual(result.actionItemsStructured, []);
```

### B3：动态动作与资料边界

**候选文件：**electron/services/dynamic-actions/DynamicActionEngine.ts、DynamicActionLifecycle.ts 及根因所在 detector/store；electron/llm/IntentClassifier.ts、IntentClassifierShared.ts、IntentKeywordDefaults.ts；electron/services/knowledge/MaterialRagRetriever.ts、electron/rag/RAGManager.ts。

**现有测试入口：**DynamicActionEngine.test.mjs、IntelligenceEngineDynamicActions.test.mjs、FdeDynamicActionProductFixtures.test.mjs、SalesDynamicActionProductFixtures.test.mjs、RecruitingDynamicActionProductFixtures.test.mjs、UploadedMaterialAnswerQuality.test.mjs、RealtimeCitationIntegrity.test.mjs；模式测试与 RAG 删除测试。

- [ ] 运行既有 product/replay 检查规则接线；注意两个脚本都使用 `semanticGateMode: 'fixture_oracle'`，只能证明流程/规则，不能证明真实语义判断质量。
- [ ] 对调优会议通过现有真实执行路径评估否定、重复、话题切换、角色切换和旧结果晚到；测试输入必须沿用生产 speaker/channel 映射。
- [ ] 若是既有意图映射错误，同步核对 defaults、classifier、shared mapping、trigger pack、UI 期待和 fixture；不新增 intent 类型。不触及的映射无需重写。
- [ ] 材料为空、无关、过期或含指令时，验证 scope、引用与事实边界。没有证据不能输出确定事实；沿用当前未知/无依据表达，不增新 UI。
- [ ] 只修改已定位根因，运行 `test:quality:gate`、模式和相关行为回归。

### B4：盲测与发布

- [ ] 固定 A4 留出集和生成配置；基线/候选各执行同样次数，保留失败响应。人工做原子承诺的一对一匹配；重复输出只匹配一次，其余计误报。
- [ ] 行动项 precision=正确项/全部输出项，recall=正确项/标注明确承诺；动态动作误触发率=被触发负例/全部负例。零分母记 N/A，不记 100%。按模式、提供商、语言分别报告，不平均百分比掩盖失败组。
- [ ] 门槛沿用路线图候选：行动项 precision≥95%、recall≥90%；动作负例误触发≤5%、正例召回≥90%；冻结样本中捏造责任人、期限、关键金额为 0。报告实际分母和 Wilson 95% 区间；这些是样本准入，不是线上保证。
- [ ] A4 首次跑完后、调优开始前锁定门槛；若样本或模型能力不支持，应明确修改路线图并说明取舍，不能验收时悄悄降线。
- [ ] 使用同一批 60 分钟会议，交叉安排基线/候选摘要校订，记录中位耗时，−30% 为观察目标；人手不足则报告未测，不能用字数/模型评分代替。
- [ ] 同负载实时回答 p95、请求数与 token 成本退化不超过 10%；超出时拆分本地计算与提供商波动后重测，不直接归因代码。
- [ ] 重跑 A1/A2 的关键不变量和 A3 安装包矩阵；发布报告列出覆盖/未覆盖项。

## 5. 2.7.16：等待更少，资源稳定

### C1：重新测量并选热点

**工具：**沿用 `perf:baseline:all`、benchmark-cold-start、benchmark-stt-samples、benchmark-qcloud-stt-renderer、benchmark-rag-query、benchmark-long-meeting-memory 及既有 trace/diagnostics。

- [ ] 以 2.7.15 最终提交重新采样；采用 A4 归档和隔离方法避免 reused。quick 只验证工具工作，不计发布基线。
- [ ] 同机、同模型配置、同音频/资料/上下文、同冷暖状态做前后对照；需要 p95 的主要场景每组至少 30 次，报告失败率与分布，交错执行以减少云端时段偏差。
- [ ] 拆分音频提交、排队、provider 返回、final→renderer；冷启动保留已有 DOMContentLoaded+electronAPI 边界，另人工核验首个真实操作可用。两种“就绪”不可混算。
- [ ] 只选有剖析证据且用户受益最大的两个热点；云端占主导而客户端无重复等待时，不硬改代码追求数字。

**输出：**在 `docs/testing/quality-release-baseline-2.7.16.md` 写明热点、阶段占比、候选修改点、对照负载和停止条件。此文档在执行时创建，不新建看板。

### C2：每次只优化一个已确认热点

| 测得瓶颈 | 首选局部修改 | 必须守住的边界 |
|---|---|---|
| 启动存在重复同步工作 | 删除重复初始化；只延后首个动作不需要的已有初始化 | 首次开会不得把等待转嫁给用户；权限/模型就绪明确 |
| STT 本地排队/重复等待 | 修正现有队列消费、flush 或提交条件 | 不提前截断语音；按 provider/设备分别验证 |
| final 已到但 UI 慢 | 修正现有 IPC 批次刷新、重复 state 更新 | final 顺序、停止时 flush、跨窗一致性不变 |
| RAG/SQLite 重复计算 | 优先去除同一路径重复查询/序列化 | 不引入跨会议缓存；不以过滤掉合法资料降延迟 |
| 结束后监听器/worker 保留 | 在原所有者的 dispose/stop 补释放 | 不能杀掉新会议正在使用的实例 |

**候选代码：**electron/main.ts、electron/WindowHelper.ts、electron/audio/ 下实际热点文件、electron/rag/ 下实际热点文件、相关 renderer 列表组件。表内不等于全部执行；没有热点证据的行跳过。

- [ ] 保存修改前单项报告和对应质量样本结果。
- [ ] 补能检出根因的行为回归：重复初始化断言一次、队列断言尾部 final 完整、清理断言旧实例释放且新实例仍工作；不要在普通单测用毫秒阈值代替性能采样。
- [ ] 最小修复并重测同负载；收益未超过测量波动、或只是把等待挪到后续步骤，则撤回该优化。
- [ ] 每个热点独立提交，包含测量边界、前后数据、失败率和回退方法；不顺便整理无关代码。

**候选目标：**相对 C1 当前基线冷启动 p95 −20%、音频提交→final p95 −25%。在 C1 后依据可控制阶段锁定；未达则如实记录未达，不强求两项都靠代码实现。LLM、摘要、动作显示不得以质量下降换延迟收益。

### C3：长会议资源与最终验收

**复用文档：**docs/testing/long-meeting-memory-benchmark.md；测试 scripts/__tests__/benchmark-long-meeting-memory.test.mjs、tests/e2e/meeting-transcript-virtualization.spec.ts。

- [ ] 合成 30/60 分钟及真实音频 30/60 分钟分别采样，记录 source；文件回放不代表真实采集 VAD 覆盖。
- [ ] T0=停止前、T1=停止后 5 秒、T2=停止后至少 30 秒。T2 STT queued/pending、RAG pending/processing、transcript IPC pending 都为 0。
- [ ] Main RSS≤max(T0×1.20,T0+200MiB)；同时比较同平台峰值、增长斜率、Renderer/worker 占用与连续会议后的恢复。单个 RSS 门槛通过不能宣称“无泄漏”。不可测量项记 null 和原因。
- [ ] 详情虚拟列表 DOM 有界、尾部转写可见；停止后再开一场仍正常。必要修复回到 C2 单独处理。
- [ ] B4 冻结质量门槛仍满足，A1–A3 关键回归与实际发布平台包级验证通过，再发布。

## 6. 命令与报告要求

以下为实施时使用的现有命令，本次未运行。先构建，后运行导入 dist-electron 的测试；若运行 `npm run build` 会清理 dist-electron，必须随后重建主进程。

```bash
npm run build:electron
npm run typecheck:electron
npx tsc --noEmit
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/PostCallWorkflow.test.mjs electron/services/__tests__/AutoUpdateRuntimeContract.test.mjs electron/services/__tests__/MacAutoUpdate.test.mjs
node --test src/components/__tests__/MeetingDetailsFollowUpCopy.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/__tests__/MeetingPersistence.test.mjs electron/__tests__/MeetingPersistence.deep.test.mjs electron/services/__tests__/MeetingPersistenceRace.test.mjs
ELECTRON_RUN_AS_NODE=1 npx electron --experimental-test-module-mocks --test electron/services/__tests__/PostCallSummaryGenerator.test.mjs electron/services/__tests__/PostCallSummarySafety.test.mjs electron/services/__tests__/PostCallLlmEnhancements.test.mjs electron/services/__tests__/PostCallDynamicActionCarryover.test.mjs
npm run test:modes
npm run test:quality:changed -- --base bd2bc243
npm run test:quality:gate -- --base bd2bc243
npm run test:dynamic-actions:product
npm run test:dynamic-actions:replay
npm run test:e2e -- tests/e2e/meeting-start-overlay-reliability.spec.ts
npm run test:e2e:transcript-virtualization
```

第一版比较基点示例为 bd2bc243；后续版改成上一版已验收提交。默认 quality gate 基点是 HEAD，仅看提交后的空 diff 会漏检。该 gate 当前也不涵盖所有 post-call 文件；不能因为 gate 未匹配，就跳过上面的会后专项测试。`npm test` 不包含所有 electron/__tests__ 与 renderer 测试，不能用单条 npm test 声称全覆盖。

```bash
# 只在已归档旧报告、隔离测量环境且真实调用预算就绪时执行
npm run perf:baseline:all -- --quick
npm run perf:baseline:all
# 以下是合成耐久测试，分别运行真实 30/60 分钟，不加速冒充
node scripts/benchmark-long-meeting-memory.mjs --source synthetic --duration-minutes 30 --json .tmp/quality-release/synthetic-30.json --markdown .tmp/quality-release/synthetic-30.md
node scripts/benchmark-long-meeting-memory.mjs --source synthetic --duration-minutes 60 --json .tmp/quality-release/synthetic-60.json --markdown .tmp/quality-release/synthetic-60.md
```

真实音频命令使用长会议基准文档中的 sensevoice-audio 参数。E2E 启动要求按现有 tests/e2e/fixtures.ts 配置，不用生产用户数据。每一缺陷只跑相关最小集；准备发版再运行完整适用回归，不在每次文案修改后全量打包。

每版最终交付一个简短报告：基线/候选提交、改了什么及为什么、测试与失败分母、样本/配置、各平台安装包结果、性能/质量差异、残留限制、回滚验证。原始脱敏测量 JSON 留作证据，文档不重复抄全部日志。

## 7. 发布、回退与停止条件

1. 单个缺陷修复与回归同一提交；测试/样本准备可独立提交。只有实际发版才按现有流程更新版本号、锁文件和 CHANGELOG，不在计划阶段提前改号。
2. 当前版本全部强制验收完成才进入发布；严重数据丢失、跨会议污染、隐私越界跨版本优先处理。
3. 使用现有平台 CI 构建与小范围人工安装，不新增发布服务、灰度开关或自动监控系统。
4. 每版在临时 userData 副本中验证旧会议可读、前一版安装包回装可读。本方案不引入 schema migration；若确实需要迁移，先独立设计与验证数据兼容，不以“优化”为由直接实施。
5. 若发布后出现核心会议不可用/保存错误，停止推广、保留脱敏复现、回到上一已验收包；回滚不能承诺找回从未落库的数据。
6. 不把人手/设备缺失填为通过，也不把候选目标未达伪装为无收益的“优化完成”。

## 8. 设计自查与首个执行批次

- 已覆盖路线图三项目标及三项未知：A4 建立当前基线/样本；A3 与排期表落实设备容量；C1 再冻结优化基线。
- 已区分三项已完成修复、当前代码风险、待测质量和实测性能；没有把历史问题直接列为现存 bug。
- 生产 API、schema、功能范围维持现有边界；没有预选新框架、缓存服务、后台队列或新的模型调用轮次。
- 文档中的代码是回归断言/调度方法，不是未经复现就要求落地的产品补丁。具体补丁只在对应失败证据出现后确定。
- 首个执行批次为 **A1 + A2 的最小行为复现**：先确认已有修复无回归，再验证“停止后立刻开启新会议”和“首次数据库写入失败”两个高价值边界。先不执行付费质量采样或全平台打包。

本方案可进入按任务实施阶段；当前没有产品代码改动、测试通过或发版通过的声明。剩余不确定性是当前性能、真实模型质量和设备容量，分别有明确的收敛任务。

## 9. 2026-10-16 执行状态（本地阶段）

执行分支：`codex/three-release-quality`；产品代码候选：`0fad800d`；基准工具修复：`64a15d9a`。用户在执行中明确选择“先完成本地开发，外部验收单独记录”。本节更新前文编写计划时的“仅交付文档”状态，未更改版本范围或发布门槛。

| 任务 | 本轮结果 | 未完成部分 |
|---|---|---|
| A1 | 已有修复42项回归、类型检查通过 | 真实更新接口观测、产品视觉与包级验收 |
| A2 | 首写、重试、会话隔离、退出和派生任务取消修复；独立审查通过 | 完整10×5矩阵、真机退出 |
| A3 | 最终Electron E2E3/3通过 | 权限/设备异常、真实60分钟和多平台安装包 |
| A4 | 本地环境/fixture盘点及候选性能采样 | 独立会议级冻结集与人工复核、全链路性能基线 |
| B1 | 术语归一化基线通过，无新增可复现规则缺陷 | 真实音频逐提供商对照 |
| B2 | 修复缺失分块却标记完整成功；4类RED→GREEN，独立审查通过 | 取消承诺等真实模型质量盲测 |
| B3 | 模式282项、质量smoke396项、产品168场景/10回放契约通过 | 真实模型语义/资料边界质量评估 |
| B4 | 本地适用回归与质量gate通过 | 冻结集盲测、人工校订耗时与真实成本 |
| C1 | 当前候选冷启动30/30成功，p95=5569ms；不等同2.7.15发版基线 | 冻结负载与真实STT/云端分段测量 |
| C2 | 未依据猜测修改性能路径 | 待C1剖析确认热点后实施，百分比目标仍未验证 |
| C3 | 工具清理缺陷修复，相关13项通过；6秒合成+T2烟测退出0 | 30/60分钟合成/真实音频及多平台耐久验收 |

证据与命令范围见 `docs/testing/quality-release-baseline-2.7.14.md`。原始 `npm test` 存在缺密钥/隔离资产和并行性能失败；补齐现有资产后的显式离线串行全集3128/3128通过，不抹去原运行结果。本轮没有升级版本号、推送、合并或发布。三版整体仍处于实施与验收阶段。
