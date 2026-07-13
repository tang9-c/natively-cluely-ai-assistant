# Sales 模式工业软件语义优化方案

## Summary

将 `sales` 模式升级为能理解工业软件销售中的痛点、功能适配、流程集成、价值诉求和场景化案例请求，并优先帮助销售问出高价值 discovery 问题。

核心设计：

- 新增 5 个顶层 sales 语义 intent。
- UI 先只新增一个“追问关键问题”卡片 `discovery_question`。
- 5 个 intent 都映射到该卡片，但 prompt 会根据 intent 生成不同方向的问题。
- 测试必须按场景和领域准备 fixture，覆盖 PLM、QMS、ERP、MES、ALM、3D 设计软件、AI 智能体等工业软件领域。

## Key Changes

- 新增 sales intent：
  - `sales_pain_discovery`：客户在讲痛点、现状问题、流程卡点、人工低效。
  - `sales_capability_fit`：客户在问功能是否支持、是否适合产品、流程或角色。
  - `sales_process_integration`：客户在讲跨系统打通、数据方向、同步、闭环。
  - `sales_value_discovery`：客户在讲效率、质量、返工、延期、审计压力、重复录入。
  - `sales_contextual_proof_discovery`：客户在要案例、类似客户、ROI 或 proof，但语义重点是“有没有类似行业/流程/系统对象的落地场景”。

- `IntentClassifier`
  - `ConversationIntent` 增加上述 5 个 intent。
  - `getCandidateIntentsForMode('sales')` 增加这 5 个 intent。
  - Tier 1 只覆盖高置信工业软件句式，避免关键词花园。
  - Tier 2 cloud classifier 作为主力，负责自然表达和多领域语义判断。

- Dynamic Action
  - 新增 sales 动作类型 `discovery_question`。
  - 5 个新增 intent 都映射到 `discovery_question`。
  - `discovery_question` 接受后输出 1-3 个问题，不介绍产品能力、不编案例。
  - prompt 根据 semantic intent 调整：
    - pain：问断点、谁在补、当前替代方案、影响。
    - capability：问目标流程、必须支持对象、验证方式。
    - integration：问源系统、目标系统、数据方向、读写边界。
    - value：问成本、周期、质量、审计、成功指标。
    - contextual proof：问行业、流程断点、系统组合、数据对象、成功指标，以便匹配案例。

## Test Matrix

测试必须覆盖这些工业软件领域，每个领域至少包含 5 类 intent 和 1 个负例。

- PLM
  - BOM、ECO、ECN、图纸发布、版本、变更影响分析、Windchill。
  - 例：`BOM 变更和质量问题能不能关联起来？`

- QMS
  - CAPA、NCR、8D、客诉、审计、质量追溯、偏差闭环。
  - 例：`现在客诉、NCR、CAPA 都在 Excel 里跟，审计时很痛苦。`

- ERP
  - 物料主数据、采购、成本、库存、订单、SAP/Oracle、财务和业务数据一致性。
  - 例：`ERP 里的物料主数据和 PLM 的 BOM 经常不一致。`

- MES
  - 工单、工艺路线、设备、现场执行、生产追溯、良率、停线。
  - 例：`MES 现场执行和设计变更不同步，生产经常拿到旧工艺。`

- ALM
  - 需求、测试、缺陷、版本发布、追踪矩阵、软件合规。
  - 例：`需求改了以后，测试用例和缺陷追踪经常断链。`

- 3D 设计软件
  - Creo、CAD、图纸、模型、装配、版本、设计变更、仿真。
  - 例：`Creo 图纸改完以后，PLM 里的版本和工艺路线同步不及时。`

- AI 智能体
  - 只读查询、工具调用、人工确认、审批建议、不能自动写回、知识源。
  - 例：`AI Agent 能不能先帮我们查变更影响，但不要自动写回 PLM？`

## Test Cases

- Intent classifier
  - 每个领域至少覆盖：
    - `sales_pain_discovery`
    - `sales_capability_fit`
    - `sales_process_integration`
    - `sales_value_discovery`
    - `sales_contextual_proof_discovery`
  - 每个领域至少 1 个负例：
    - 不应误触发 pricing。
    - 不应误触发 quote。
    - 不应把内部资料名、报价表、会议标题当客户需求。
  - 泛化案例请求仍可走 `sales_proof_request`：
    - `有没有客户案例？`
    - `Do you have a case study?`
  - 场景化案例请求走 `sales_contextual_proof_discovery`：
    - `有没有类似客户把 Creo 设计变更、Windchill ECO 和 QMS CAPA 打通的案例？`

- Dynamic action
  - 5 个新增 intent 都生成 `discovery_question`。
  - `discovery_question` 的 userAction 是 `追问关键问题`。
  - product contract 的 `whyNow` 根据 semantic intent 区分痛点、功能适配、流程集成、价值发现、场景化案例。
  - accepted output 不能包含：
    - `我们支持`
    - `我们可以`
    - `产品能够`
    - 编造客户名、ROI、指标、行业案例
  - accepted output 必须包含：
    - 1-3 个问题。
    - 至少一个问题锚定客户原话里的系统、流程或对象。

- Regression
  - 明确价格异议仍是 `sales_pricing_objection`。
  - 明确报价请求仍是 `sales_quote_request`。
  - 明确合同、试点、下一步仍是 `sales_buying_signal`。
  - 明确 API、SSO、生产部署、安全要求仍是 `sales_technical_requirements`。
  - “先不谈价格，我们要看 PLM/QMS 闭环案例”不触发 pricing，触发 `sales_contextual_proof_discovery`。

## Implementation Notes

- 优先把 fixture 做成结构化矩阵，字段包括：
  - `domain`
  - `utterance`
  - `expectedIntent`
  - `expectedAction`
  - `mustNotIntent`
  - `notes`
- 推荐新增测试文件：
  - `electron/llm/__tests__/SalesIndustrialIntent.test.mjs`
  - `electron/services/__tests__/SalesIndustrialDiscoveryActions.test.mjs`
  - `electron/services/__tests__/SalesIndustrialDiscoveryOutput.test.mjs`
- 不新增数据库 schema。
- 不新增独立 UI。
- 不引入新技术栈。
- 不把工业软件领域词做成无限关键词列表；Tier 1 只做高置信组合，长尾表达交给 Tier 2。

## Assumptions

- 新增 5 个是顶层 sales semantic intent。
- UI 先只新增一个 `discovery_question` 卡片。
- 工业软件销售默认策略是先问清业务事实，再回答功能或引用案例。
- 案例请求如果带具体工业软件场景，应先问清匹配维度，而不是直接进入泛化 proof。
