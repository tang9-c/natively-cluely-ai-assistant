# CueUp 产品力路线图：把实时会议动作卡片打穿

更新时间：2026-07-07

## 一句话判断

未来 3 个月，CueUp 不应该继续把主线写成“接更多上下文源”。

主线应该变成：在销售、FDE、团队会议这 3 类高频会议里，CueUp 能在关键瞬间自动浮出一张小卡片，告诉用户现在该做什么、为什么、点一下能生成什么，并且这张卡片大多数时候是对的。

现在的问题不是“好像能用”。是“用户敢不敢在真实会议里依赖它”。

这就是产品力。

## 北极星

会议中 2 秒内出现一张可信、可操作、可忽略的实时提醒卡片，帮助用户赢下这一轮对话。

不是给用户更多信息。是帮用户少错过关键瞬间：

- 客户说太贵时，不是总结“客户提到价格”，而是给出可说出口的价值回应。
- 客户问 PLM / QMS / 企业 AI Agent 部署时，不是泛泛解释集成，而是追问业务流程、系统边界、数据对象、权限、验证步骤和上线责任人。
- 团队说“我来跟进”时，不是会后才发现，而是当场锁定负责人、交付物和时间。

如果卡片做不到“这一下帮我省了脑子”，它就只是 UI 动效。

## 当前真相

工程地基已经不少：

- `DynamicActionEngine.assessSignals()` 已有 regex 候选、语义门控、云端仲裁、本地 fallback、reject/defer trace。
- `DynamicActionBar` / `DynamicActionCard` 已能展示、忽略、Tab 接受、5 秒自动生成。
- `ModesManager` 已有销售、FDE、团队会议等重点模式。
- `DynamicActionDetector` 已有 sales、fde、team-meet trigger packs。
- `IntentClassifier` 已有 mode-aware intent 和 answer shape。
- `RealtimeContextOrchestrator`、RAG、PPTX 知识源、Windchill 知识源、speaker policy、QCLOUD 情绪元数据都已进入上下文系统。
- `test:quality:smoke`、`test:quality:diagnostics`、`test:quality:gate` 已经存在。

但产品还没有打穿。

现在更像“信号链路存在”，不是“用户在真实会议里离不开”。卡片还缺 5 件事：

1. 每个重点模式的关键时刻定义不够产品化。
2. 卡片内容还偏“检测到某类意图”，不是“下一步该怎么做”。
3. 卡片接受后的回答质量没有按模式形成强验收。
4. 误报、漏报、延迟、接受率没有变成产品指标。
5. 真实会议回放不足，尤其是中文、英文、中英混合、多人说话、旧话题污染、ASR 错词、客户/内部成员区分。

这就是未来 3 个月的工作。

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

- `DynamicActionCard` 的所有文案从 intent label 转为 action promise。
- 统一卡片状态：candidate、countdown、generating、cancelled、expired、failed。
- 卡片解释复用 `explainDynamicAction()`，但面向用户重写，不是诊断句子。
- 加入“接受后产物类型”字段：spoken_response、checklist、email_draft、action_item、decision_record。
- 质量指标开始记录：shown、accepted、dismissed、auto_generated、expired、generated_failed。

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

- 上传 sales deck 或 case study PPTX。
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

- `SalesDynamicActionProductFixtures.test.mjs`
- `SalesDynamicActionAnswerQuality.test.mjs`
- `SalesActionCardUx.contract.test.mjs`

### Step 3：FDE 模式打穿

时间：第 6-8 周

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

- FDE 卡片按“制造业业务流程推进”组织，不按技术名词组织。
- 卡片接受后的内容默认短、具体、可问出口。
- 安全/合规卡片必须保守，不能承诺未经证实的质量、审计或权限能力。
- 风险卡片必须区分“客户流程风险”“系统权限风险”“我们交付风险”“AI Agent 误判风险”“信息缺失”。
- 下一步卡片缺 owner/date/artifact 时必须追问，不许脑补。
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
```

新增命令目标：

```bash
rtk npm run test:dynamic-actions:product
rtk npm run test:dynamic-actions:replay
rtk npm run test:dynamic-actions:metrics
```

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
| DynamicActionEngine | 已有语义门控和 trace | 变成三大重点模式的核心产品引擎 |
| DynamicActionCard | 已能展示/接受/忽略 | 升级为 action promise + evidence + output type |
| IntentClassifier | 已有 mode-aware intent | 用于模式关键瞬间召回和答案形状 |
| SignalStateTracker | 已有重复证据和冷却 | 用于降噪和用户忽略后的学习 |
| RAG / Materials | PDF/DOCX/MD/TXT/PPTX 基础已在 | 销售案例、FDE 部署方案、流程蓝图和验收材料 grounding |
| Windchill adapter | 专用只读 MCP 已在 | FDE 中 PLM 物料、BOM、变更、文档等只读事实补充 |
| Screen understanding | 已在实时路径 | FDE 看 PLM/QMS 页面、错误信息、流程图和 API 文档 |
| QCLOUD emotion | 已透传到 UI | 只作风险/语气辅助，不能单独触发动作 |
| Quality gate | 已有基础命令 | 扩成产品级 fixture 和 replay |

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

## 战略总结

CueUp 的短期产品力不来自“什么都能接一点”。

来自一个非常窄但很硬的承诺：

在真实会议的关键时刻，CueUp 会给你一张对的卡片。

它不抢话，不乱弹，不编事实。它知道现在是什么模式，知道谁在说话，知道哪些资料可用，知道什么时候该闭嘴。

这才是从“AI 会议助手”变成“会议副驾驶”。
