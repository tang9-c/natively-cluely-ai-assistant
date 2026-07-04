# CueUp 上下文系统路线图

更新时间：2026-07-04

## 北极星

会议现场 2 秒内给出能直接说出口的回答建议，并且用户知道它为什么可信。

这不是“接更多模型”，也不是“加更多工具”。核心是把当前会议、短期上下文、本地资料、历史会议、长期记忆、企业知识库、业务系统事实和屏幕内容编排成一个稳定、可解释、可评估的上下文系统。

## 当前现状

本路线图已经从“设计阶段”进入“第一版地基已落地，继续补齐验收和产品化”的阶段。根据代码图谱和最近 7 次提交（`c899566` 到 `159d371`），当前状态如下：

- 品牌外显已从 Natively 迁移到 CueUp，路线图和用户文案应继续使用 CueUp；内部遗留 provider id、类名和存储 key 可按兼容性逐步处理。
- Phase 0 的可信度闭环已有核心基础：实时答案 trace、来源状态、降级原因、引用预览、失败状态和质量事件相关测试已经存在。
- Phase 2 的实时上下文编排已有第一版：`RealtimeContextOrchestrator` 能按来源优先级去重、按 token budget 选择/丢弃上下文，并输出 `sourceStatus`、`degradedReasons`、`contextFingerprint` 和检索耗时。
- Phase 3 的受控业务系统上下文已有第一版：业务系统知识源设置、凭据、触发检测、受控查询、上下文候选注入和测试已落地。
- Phase 4 的说话人稳定性已有第一版：`SpeakerContextPolicy` 会过滤低置信度本地说话人验证元数据，并把降级原因写入答案 trace。
- 动态动作意图识别语义门控第一版已落地：regex 现在主要作为候选召回，高风险动作会经过 `ModeEventClassifier` 的动作级语义门控；`IntelligenceEngine` 会把最近 6 轮上下文、当前 mode、说话人、`intentResult` 和 provider scope 传入动态动作评估，并在需要时调用云端结构化仲裁。
- 动态动作质量回归已有固定 smoke 命令：`npm run test:quality:smoke` 覆盖语义门控、动态动作引擎、final transcript 触发路径、mode intent 和 answer trace contract。
- P0-1 仍未完全产品化：当前第一版已有核心门控和回归测试，但本地意图模型下载/不可用诊断、云端仲裁 UI 可见性、更多真实会议 fixture 和指标面板仍需补齐。
- 本地 SenseVoice 已支持 final transcript 后处理专有名词纠错。它不属于上下文编排本身，但会直接影响上下文质量，尤其是人名、公司名、产品名和业务对象 ID 的可检索性。

## 产品判断

当前最重要的用户价值仍然是：立刻给出能用的回答建议。

接下来优先级不是继续扩张到完整 MCP 工具调用，而是把已落地的上下文地基做扎实：

1. 动态动作意图识别语义门控：第一版已进入代码，接下来要把真实会议 fixture、降级诊断和产品可见解释收口。
2. 补齐实时答案可信度闭环的验收指标和回归评测。
3. 把 `RealtimeContextOrchestrator` 从“主链路第一版”推进到“所有实时回答关键路径一致使用”。
4. 继续产品化本地 RAG、资料上传和统一知识源设置。
5. 把受控业务系统上下文从 demo/fixture 级验证推进到可配置、可诊断、可审计的只读能力。
6. 扩大短期上下文和说话人稳定性的评测覆盖。
7. 建立长期记忆 V1。
8. 建立通用只读企业知识连接器。
9. 最后再进入通用 MCP 只读适配器；可写工具仍不进入 P0。

## 上下文层

```text
实时回答请求
   |
   v
Realtime Context Orchestrator
   |
   +-- 当前会议上下文
   |   - 当前转录文本
   |   - 说话人分离
   |   - 本地说话人验证元数据
   |   - 屏幕上下文
   |
   +-- 短期记忆
   |   - 最近 N 轮对话
   |   - 当前问题前后的局部上下文
   |
   +-- 本地知识 RAG
   |   - 用户上传资料
   |   - 模式参考资料
   |   - 历史会议
   |   - 已缓存企业知识
   |
   +-- 受控业务系统上下文
   |   - PLM BOM / 物料 / 版本
   |   - PLM ECO / ECN / 变更影响范围
   |   - QMS CAPA / NCR / 偏差 / 问题状态
   |   - 审批状态 / 负责人 / 更新时间
   |
   +-- 长期记忆
   |   - 用户偏好
   |   - 人物/客户关系
   |   - 行为事件
   |   - 常见回答风格
   |
   +-- 企业知识连接器
       - 只读同步
       - 后台更新
       - 写入本地索引
```

实时路径必须主要依赖本地可用的上下文。PLM/QMS 可以允许受控 live read，但必须带超时、来源和查询状态；远程企业知识库和 MCP 只读调用默认应当用于预取、同步、缓存、增量刷新，不能让会议现场的回答无条件等待远程工具返回。

## 已完成地基

### P0-1：动态动作意图识别语义门控

状态：第一版已落地，当前第一优先进入验收收口。首批锚点提交：`2e6a37d`、`8fb47c3`、`215694c`、`9a5e913`、`4c212db`；本轮 P1-P3 修复在本提交中落地。

目标：动态动作不能只因为单词或短语命中就执行。系统必须先结合当前 turn、最近几轮上下文、当前 mode、说话人和已有 `intentResult` 理解整体意思，再决定是否生成、展示或自动执行动作。

已完成：

- `DynamicActionEngine.assessSignals()` 已改为异步语义门控路径，regex trigger 只生成候选动作，高风险动作必须通过 `ModeEventClassifier` 的 `pass` 或白名单 `fast_path` 才会进入 `SignalStateTracker` 和 action 构建。
- 新增动作级 `ModeEventClassifier`，输出 `pass` / `reject` / `defer` / `fast_path`，并记录候选、语义意图、置信度、原因、云端仲裁、本地判断和降级原因。
- `DynamicActionEngine.assessSignals()` 会为所有 gate decision 输出内部诊断 trace；`reject` / `defer` 仍不生成 action、不进入 store，但可以解释为什么候选被拦截。
- `IntelligenceEngine` 会传入最近 6 轮上下文、当前 mode、说话人、`intentResult`、provider data scope，并提供 `classifyDynamicActionWithCloud()` 云端结构化仲裁。
- 云端语义门控只允许从 regex 候选 action type 中选择，返回严格 JSON；调用设置短超时，失败时回到本地明确高置信判断或降级。
- 已移除 sales `discovery_probe -> pricing_request` 的默认映射，降低价格动作误报。
- 已补充报价请求、案例/证明请求、技术需求/集成需求的中英文召回与本地语义确认，包括“发我报价”“多少钱”“我们想看案例”“类似客户”等常见表达。
- `detectActions()` 已标注为 legacy 同步 regex detector；生产动态动作发射应使用 `assessSignals()`。
- 新增 `npm run test:quality:smoke`，固定覆盖语义门控、动态动作引擎、final transcript 动态动作召回、mode intent 和答案 trace contract；连续本地验证可先运行 `rtk npm run build:electron`，再运行 `rtk npm run test:quality:smoke:no-build` 与 `rtk npm run test:quality:diagnostics:no-build`，避免重复构建。
- `ContextQualityDiagnosticsCollector` 已接入动态动作 gate trace、实时回答 context plan 摘要和 answer quality metrics 查询结果；只记录 action type、decision、reason、来源类型和 timing，不记录 transcript、prompt、截图或 evidence text。采集器为有界最近样本；`context-quality-smoke-report.mjs` 无 JSON 输入时只读取脚本当前进程的空/本地快照，并会显式标记为 `process_local_snapshot`。
- 回归测试已覆盖：
  - final transcript 触发动态动作；
  - 动态动作语义门控召回；
  - 云端不可用时保留明确本地高置信召回；
  - 中性价格提及拦截；
  - `price list` / `pricing page` / `成本数据` 等不触发价格异议。

仍需补齐：

- 本地意图识别模型未下载、未开启、加载失败或超时时的用户可见诊断；当前第一版不能假设本地模型一定存在。
- 云端仲裁被 provider data scope 禁止、provider 不可用、JSON 非法或超时时已有内部 trace/diagnostics；仍需决定是否以及如何在产品 UI 中展示。
- 更多真实会议 fixture，尤其是中文、英文、混合语言、多轮转折、多人说话和旧话题污染当前判断的场景。
- 高风险 `defer` 的产品策略：等待重复证据、低优先级卡片或完全静默，需要用真实使用数据继续定。
- 动态动作质量指标的产品化展示：误报率、漏报率、defer 升级率和平均仲裁延迟仍未形成 dashboard；内部诊断已覆盖 pass/reject/defer、云端不可用、本地 fallback 和降级原因分布。

实施要求：

- regex 只作为候选信号，不直接等同于动作。
- 增加 `ModeEventClassifier` 或等价语义门控层，输入至少包含：
  - 当前 final transcript；
  - 最近 4-6 轮上下文，第一版代码默认传最近 6 轮；
  - 当前 mode/template；
  - `intentResult`；
  - 说话人/channel；
  - 已有 active dynamic action。
- 高误报类型必须“双确认”：
  - 价格异议；
  - 报价请求；
  - 案例/证明请求；
  - 技术需求/集成需求；
  - 下一步/购买信号。
- 高价值明确动作可以保留强规则快速通道，但需要白名单：
  - 发合同；
  - 安排时间；
  - 屏幕上有技术题；
  - 明确 action item。
- 对于语义不确定的候选，只生成低优先级卡片、等待重复证据或拒绝，不自动执行；第一版更偏保守。
- trace 中记录：
  - regex 候选；
  - semantic intent；
  - 是否通过门控；
  - 被拒绝原因；
  - 是否因重复证据升级。

验收标准：

- 已覆盖的验收必须持续通过：
  - “price list / pricing page / 成本数据”这类中性提及不能触发价格异议。
  - 明确价格异议、报价请求、案例/证明请求和技术需求表达能被召回。
  - final transcript 路径能生成经过语义门控的动态动作。
  - 云端不可用时，明确高置信本地语义不能被无差别降级吞掉。
- 仍需补齐的验收：
  - “价格先放一边，我们想看客户案例和 API 集成要求”不能触发价格动作，应触发案例和技术需求动作。
  - “这个技术方案怎么对接 SSO 和生产环境”能触发技术需求，而不依赖价格词或报价词。
  - “客户要一个类似案例证明 ROI”能触发案例/证明请求。
  - 每个动态动作都能解释：为什么触发、为什么没有被拦截、是否经过语义门控。
  - 相关测试必须扩展到更多中文、英文、混合语言、单句和多轮上下文 fixture。

### Phase 0：实时答案可信度闭环

状态：第一版已落地，继续补齐评测和产品指标。

已完成：

- 答案 trace 元数据和持久化基础。
- 实时答案来源状态、降级原因和失败状态展示。
- 引用预览 UI，并避免把预览引用误导为完整可跳转来源。
- RAG scope denial、provider data scope、trace persistence failure 等关键失败路径测试。
- 答案质量事件、接受/重新生成/忽略生命周期的 UI contract 覆盖。

仍需补齐：

- 将小型按模式评测纳入日常回归，而不是只停留在分散 contract test。
- 建立每次 prompt、RAG、记忆或上下文选择改动后的固定评测命令。
- 汇总指标面板或开发诊断输出：
  - 答案延迟；
  - 引用命中率；
  - 用户接受率；
  - 重新生成率；
  - RAG 命中率；
  - 无上下文回答率；
  - 降级原因分布。

验收标准：

- 每个实时答案都能追踪使用了哪些上下文来源。
- RAG 不可用时，用户不会被误导为“上传资料已被使用”。
- 失败能归因到 STT、RAG、记忆、prompt、模型、provider data scope 或上下文编排。
- 团队能回答：一次 prompt、RAG、记忆或上下文选择改动是否提升了答案质量。

### Phase 1：本地 RAG 与资料上传

状态：已有材料/RAG 基础和统一知识源设置，下一步是打通更明确的产品验收。

已完成：

- 本地资料、业务系统知识源设置已在设置页中统一呈现。
- 资料型上下文已作为 `uploaded_material` / `mode_reference` 等候选来源进入实时编排模型。
- trace 和引用 UI 已能表达 RAG 命中、不可用和降级。

仍需补齐：

- 上传入口的端到端验收：
  - PDF、DOCX、PPTX、Markdown、TXT；
  - 批量上传；
  - 文件级删除和重新索引；
  - 索引中、已完成、已失败的可见状态。
- 评测用例证明上传资料被选中、被引用，并且没有被幻觉化。
- embedding 未配置或失败时的设置诊断和用户提示。
- 已删除资料不可再被引用或检索的回归测试。

验收标准：

- 上传一份产品 FAQ，在会议中问相关问题，能得到引用该 FAQ 的回答。
- embedding 未配置时，应用展示清楚的降级状态。
- 文件索引失败时，展示可读错误。
- 已删除资料不会再被引用或检索。
- 资料支撑型答案必须通过相关评测用例，才算功能完成。

### Phase 2：Realtime Context Orchestrator

状态：第一版已实施，下一步是扩大覆盖面和收紧隐私边界。

已完成：

- `RealtimeContextSource` 已覆盖：
  - `current_transcript`；
  - `short_term_history`；
  - `business_system`；
  - `uploaded_material`；
  - `mode_reference`；
  - `historical_meetings`；
  - `profile_history`；
  - `screen_context`。
- 按来源优先级排序、按 score 排序、按内容 hash 去重。
- 按 token budget 注入或丢弃候选上下文。
- 输出：
  - `injected`；
  - `omitted`；
  - `sourceStatus`；
  - `degradedReasons`；
  - `contextFingerprint`；
  - `retrievalTimingMs`。
- 支持把注入上下文格式化为分来源 XML block。

当前限制：

- 编排层已经存在，但并不等于所有 LLM 路径都完全收敛。
- `formatInjectedContext()` 会包含候选正文，因此 trace 持久化必须继续只保存摘要、hash、来源状态和降级原因，不能保存完整 prompt、原始转录、屏幕 dump 或 chunk 正文。
- token 估算仍是粗粒度，后续要对齐实际模型 tokenizer 或统一估算策略。

下一步：

- 标记所有 LLM 路径为已迁移、待迁移或豁免。
- 主实时回答链路以外，优先迁移仍会影响“现场回答”的路径。
- 为上下文选择策略增加固定评测，覆盖：
  - token 溢出；
  - 重复上下文；
  - RAG 不可用；
  - 屏幕上下文失败；
  - provider data scope denial；
  - business system 超时或无结果。

验收标准：

- 系统能解释为什么选择或拒绝每个上下文来源。
- token 溢出时行为可预测。
- selected/rejected 上下文摘要会写入答案 trace，但不写入原始敏感正文。
- 主路径答案评测在迁移前后都会运行，答案质量、延迟、引用命中率和无上下文回答率都不能回归。

### Phase 3：受控业务系统上下文

状态：第一版已实施，定位仍是只读、受控、可审计的上下文来源，不是通用 MCP 平台。

已完成：

- 业务系统知识源设置和凭据保存。
- `BusinessSystemTriggerDetector` 判断是否需要查询业务系统。
- `BusinessSystemContextService` 按 source hint 选择启用的知识源，调用受控 client，并把成功结果转为 `business_system` 上下文候选。
- 对无配置、缺少查询锚点、无结果、多结果、认证失败、超时、不可用等状态返回固定答复，避免编造。
- 业务系统上下文已通过 orchestrator 进入主链路测试。
- 业务系统 prompt redaction 和只读边界有测试基础。

当前限制：

- 现阶段更接近受控上下文注入框架和 fixture 验证，不是完整 PLM/QMS 产品。
- `BusinessSystemContextService` 当前候选 metadata 可先保持轻量，重点是来源、状态、只读边界和失败时不编造；第一版不强制扩展完整业务对象审计字段。
- live read 的真实 connector、超时策略、缓存策略和错误诊断还需要继续产品化。

下一步：

- 完善业务系统查询状态、固定答复和降级提示，确保无配置、无结果、多结果、认证失败、超时和不可用都不会进入编造路径。
- 增加缓存/预取策略；live read 只作为受控补充，并设置 1-2 秒超时。
- 评测覆盖至少：
  - BOM 问题；
  - ECO/ECN 变更影响问题；
  - QMS 问题状态问题；
  - 无权限；
  - 对象不存在；
  - 版本冲突；
  - 数据过期。

验收标准：

- 用户在会议里问“这个 ECO 影响哪些 BOM？”时，CueUp 能在 2 秒目标内给出带来源和查询状态的答案。
- 如果使用缓存数据，答案必须明确说明数据时间戳。
- 如果 live read 超时或失败，会议回答继续进行，并展示清楚降级原因。
- 无权限、对象不存在、版本冲突、状态过期时，系统不会编造答案。
- 不存在写回 PLM/QMS 的工具调用。

### Phase 4：短期上下文和说话人稳定性

状态：说话人策略第一版已实施，短期上下文评测仍需加强。

已完成：

- `SpeakerContextPolicy` 会检查本地说话人验证元数据。
- 只有高置信度 `me` 验证会保留给答案路径。
- 低置信度或不可用说话人元数据会被移除，并记录：
  - `speaker_metadata_low_confidence`；
  - `speaker_metadata_unavailable`。
- trace 中记录是否使用本地验证、是否使用 diarization、置信度摘要和来源。

仍需补齐：

- 最近 N 轮对话选择策略的固定评测。
- 依赖“谁在说话”才能答对的端到端场景。
- Doubao AUC diarization、本地 speaker verification 和 mic/system channel 的冲突处理策略。
- 低置信度说话人状态在 UI/诊断中的可见解释。

验收标准：

- 答案路径能使用最近轮次，同时不会拉入过期或无关的会议历史。
- 只有置信度足够高时才包含说话人元数据。
- 低置信度说话人状态会显式降级，而不是静默影响答案。
- 评测至少覆盖一个依赖“谁在说话”或“最近几轮说了什么”才能答对的用例。

### STT 上下文质量：Local SenseVoice 专名纠错

状态：第一版已实施，属于上下文系统的输入质量优化。

已完成：

- Local SenseVoice final transcript 后处理专有名词纠错。
- 支持中英文 canonical term、常见误识别 variants、启用/禁用、设置持久化和 UI 配置。
- 纠错发生在 final transcript 后，不假设 SenseVoice 原生支持解码期热词偏置。
- UI 会提示空 variants 不会生效。
- registry 会把设置注入 Local SenseVoice provider，并在设置不可用时安全降级。

当前边界：

- 只能修正常见、稳定、可枚举的误识别。
- 不能让模型在解码时“提前知道”热词，因此不能解决所有上下文词表问题。
- homophone replacer 和 SenseVoice 专属 VAD profile 仍未接入。

下一步：

- 建立默认错词表来源：
  - 参会人名；
  - 公司名；
  - 产品名；
  - 当前 mode；
  - 参考资料标题；
  - 用户自定义术语。
- 评估 sherpa-onnx SenseVoice homophone replacer 是否适合接入。
- 为中文会议模式测试 SenseVoice 专属 VAD 参数 profile，尤其是 hangover、min speech、最大段长。

## 后续阶段

### Phase 5：长期记忆 V1

状态：未开始。

目标：让 CueUp 记住用户是谁、用户偏好的回答方式，以及反复出现的人物关系或历史事实。

交付物：

- 记忆类型：
  - 用户偏好；
  - 人物/客户关系；
  - 历史事件；
  - 回答风格；
  - 禁忌或永不使用的信息。
- 记忆字段：
  - 内容；
  - 类型；
  - 来源；
  - 时间戳；
  - 置信度；
  - 用户确认标记。
- 检索通过 `RealtimeContextOrchestrator`。
- 设置项支持关闭长期记忆。
- 用户可以查看和删除记忆。

验收标准：

- 如果用户说“以后回答客户问题直接一点”，相似的未来场景会体现该偏好。
- 低置信度记忆不会直接进入 prompt。
- 已删除记忆不会再被检索或使用。
- 隐私设置会被遵守。

风险：

- 如果低置信度或过期记忆被当成事实，长期记忆会变成持久化幻觉。
- 第一版记忆必须带来源、时间、置信度和删除控制。

### Phase 6：通用只读企业知识连接器

状态：未开始；应建立在本地 RAG 和知识源设置稳定之后。

目标：减少手动上传负担，同时不让远程调用阻塞实时答案生成。

交付物：

- 先接入 1-2 个文档型来源：
  - GitHub 文档或仓库内容；
  - Notion、Confluence 或 Google Drive 之一。
- 只读同步。
- 同步内容到本地索引。
- 增量刷新。
- 来源引用。
- 连接状态和最后同步时间。
- 权限撤销。

验收标准：

- 企业文档知识会同步进本地 RAG。
- 实时答案不会阻塞在远程 API 上。
- 连接器失败不会破坏会议流程。
- 答案引用能指回原始文档。

产品命名：

- 对外展示为“Knowledge Sources”或“资料来源”。
- 第一版不要向普通用户暴露“MCP”。

### Phase 7：通用 MCP 只读适配器

状态：长期扩展层。

目标：把 MCP 兼容性作为扩展层加入，而不是作为第一批用户可见产品表面。

交付物：

- MCP 只读资源适配器。
- allowlist。
- 调用日志。
- 超时和缓存策略。
- 无写操作。
- 不为普通用户提供通用 MCP server 管理界面。

不在范围内：

- 完整 MCP 工具执行。
- 写入 CRM 记录。
- 创建 Jira 任务。
- 发送 Slack 消息。
- 通用自动化工作流构建器。

## 更新后的推荐执行顺序

```text
当前冲刺：
  1. P0-1：动态动作意图识别语义门控第一版验收收口，补真实会议 fixture、降级诊断和质量指标。
  2. Phase 0/2/3/4 已落地能力的验收收口。
  3. 扩展上下文质量回归评测命令和指标输出；现有基础命令为 npm run test:quality:smoke，连续本地验证可使用 no-build 变体。
  4. 清点所有实时回答相关 LLM 路径，标记已迁移、待迁移或豁免。

下一冲刺：
  5. 本地 RAG/资料上传端到端验收。
  6. 业务系统上下文查询状态、降级提示和超时/缓存策略。
  7. SenseVoice 错词表来源自动化和 homophone replacer 调研验证。

随后：
  8. 长期记忆 V1。
  9. 通用只读企业知识连接器。

之后：
  10. 通用 MCP 只读适配器。
  11. 可写工具和自动化工作流继续保持非 P0。
```

## P0 要求

P0 只包含决定用户是否会在现场信任 CueUp 的事项：

- 实时答案质量评估闭环。
- 动态动作意图识别语义门控。
- `RealtimeContextOrchestrator` 覆盖主实时回答关键路径。
- 本地 RAG、资料上传和引用。
- PLM/QMS 只读业务系统上下文。
- 短期上下文和说话人稳定性。
- Local SenseVoice 输入质量优化。
- 可见降级和设置诊断。

P0 之后再进入：

- 长期记忆 V1。
- 通用只读企业知识连接器。

## 非 P0

- 完整通用 MCP 工具调用。
- 写入 CRM、Jira、Slack 或 email。
- 写回 PLM/QMS。
- 通用 MCP server 管理界面。
- 大型 provider marketplace。
- 复杂自动化工作流构建器。

## 战略总结

本地 RAG 让答案有依据。

实时上下文编排让依据进入 prompt 的过程可解释、可裁剪、可评测。

PLM/QMS 只读业务系统上下文让会议现场能直接使用 BOM、变更和质量记录这些事实。

短期记忆让答案连接当前对话。

说话人稳定性避免助手替错误的人回答。

SenseVoice 专名纠错提高输入文本质量，减少专名误识别对检索和回答的污染。

长期记忆让答案更贴合用户本人。

通用企业知识连接器让文档型 grounding 在不依赖手动上传的情况下扩展。

受控领域 MCP 应该服务 PLM/QMS 这类高价值只读上下文。通用 MCP 后续可以作为扩展层使用，但不应该成为核心用户价值的第一条实施路径。

产品应该先让上下文准确、快速、可信、可测量，然后再扩展上下文来源。
