export const DISCOVERY_INTENTS = [
  'sales_pain_discovery',
  'sales_capability_fit',
  'sales_process_integration',
  'sales_value_discovery',
  'sales_contextual_proof_discovery',
];

export const SALES_INDUSTRIAL_POSITIVE_FIXTURES = [
  { domain: 'PLM', utterance: '现在 BOM 变更靠邮件通知，设计、工艺和质量经常不同步。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', notes: 'PLM pain' },
  { domain: 'PLM', utterance: 'BOM 变更和质量问题能不能关联起来？', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', notes: 'PLM capability fit' },
  { domain: 'PLM', utterance: 'Windchill ECO、ERP 物料和 QMS CAPA 能不能形成闭环？', expectedIntent: 'sales_process_integration', expectedAction: 'discovery_question', notes: 'PLM integration' },
  { domain: 'PLM', utterance: '变更影响分析太慢，导致图纸发布和工艺更新周期都被拖长。', expectedIntent: 'sales_value_discovery', expectedAction: 'discovery_question', notes: 'PLM value' },
  { domain: 'PLM', utterance: '有没有类似客户把 Windchill ECO 和 QMS CAPA 打通的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', notes: 'PLM contextual proof' },

  { domain: 'QMS', utterance: '现在客诉、NCR、CAPA 都在 Excel 里跟，审计时很痛苦。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', notes: 'QMS pain' },
  { domain: 'QMS', utterance: '你们能不能支持 8D、CAPA 和审计发现之间的追溯？', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', notes: 'QMS capability fit' },
  { domain: 'QMS', utterance: 'QMS 的 NCR 能不能和 MES 工单、PLM 图纸版本关联起来？', expectedIntent: 'sales_process_integration', expectedAction: 'discovery_question', notes: 'QMS integration' },
  { domain: 'QMS', utterance: '我们现在关闭 CAPA 要很久，质量成本和审核压力都很大。', expectedIntent: 'sales_value_discovery', expectedAction: 'discovery_question', notes: 'QMS value' },
  { domain: 'QMS', utterance: '有没有医疗器械客户把 NCR、CAPA、审计闭环跑通的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', notes: 'QMS contextual proof' },

  { domain: 'ERP', utterance: 'ERP 里的物料主数据和 PLM 的 BOM 经常不一致。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', notes: 'ERP pain' },
  { domain: 'ERP', utterance: '你们能不能校验 SAP 物料、成本和 PLM BOM 的一致性？', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', notes: 'ERP capability fit' },
  { domain: 'ERP', utterance: 'PLM 发布 BOM 后，能不能同步到 SAP 采购和成本模块？', expectedIntent: 'sales_process_integration', expectedAction: 'discovery_question', notes: 'ERP integration' },
  { domain: 'ERP', utterance: '重复录入物料和成本数据太浪费时间，还经常影响订单交付。', expectedIntent: 'sales_value_discovery', expectedAction: 'discovery_question', notes: 'ERP value' },
  { domain: 'ERP', utterance: '有没有类似制造客户把 Oracle ERP 和 PLM BOM 对齐的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', notes: 'ERP contextual proof' },

  { domain: 'MES', utterance: 'MES 现场执行和设计变更不同步，生产经常拿到旧工艺。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', notes: 'MES pain' },
  { domain: 'MES', utterance: '你们能不能支持工单、工艺路线和设备参数的追踪？', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', notes: 'MES capability fit' },
  { domain: 'MES', utterance: 'PLM 的工艺变更能不能同步到 MES 工单和现场执行？', expectedIntent: 'sales_process_integration', expectedAction: 'discovery_question', notes: 'MES integration' },
  { domain: 'MES', utterance: '旧工艺导致返工和停线，良率也受影响。', expectedIntent: 'sales_value_discovery', expectedAction: 'discovery_question', notes: 'MES value' },
  { domain: 'MES', utterance: '有没有离散制造客户把 PLM 工艺路线和 MES 执行闭环的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', notes: 'MES contextual proof' },

  { domain: 'ALM', utterance: '需求改了以后，测试用例和缺陷追踪经常断链。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', notes: 'ALM pain' },
  { domain: 'ALM', utterance: '你们能不能支持需求、测试、缺陷和发布版本的追踪矩阵？', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', notes: 'ALM capability fit' },
  { domain: 'ALM', utterance: 'ALM 需求变更能不能同步到测试平台和缺陷系统？', expectedIntent: 'sales_process_integration', expectedAction: 'discovery_question', notes: 'ALM integration' },
  { domain: 'ALM', utterance: '软件合规审计时找证据很慢，发布周期被拉长。', expectedIntent: 'sales_value_discovery', expectedAction: 'discovery_question', notes: 'ALM value' },
  { domain: 'ALM', utterance: '有没有汽车软件客户把需求、测试和缺陷追踪矩阵落地的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', notes: 'ALM contextual proof' },

  { domain: '3D design software', utterance: 'Creo 图纸改完以后，PLM 里的版本和工艺路线同步不及时。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', notes: 'Creo pain' },
  { domain: '3D design software', utterance: '请介绍一下你们在流体仿真方面的功能。', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', notes: 'fluid simulation capability fit' },
  { domain: '3D design software', utterance: 'Creo 设计变更能不能和 Windchill ECO、MES 工艺路线打通？', expectedIntent: 'sales_process_integration', expectedAction: 'discovery_question', notes: 'Creo integration' },
  { domain: '3D design software', utterance: '设计仿真和图纸版本管理太分散，工程师重复验证很多次。', expectedIntent: 'sales_value_discovery', expectedAction: 'discovery_question', notes: 'Creo value' },
  { domain: '3D design software', utterance: '有没有类似客户把 Creo 仿真、设计变更和 PLM 版本管理串起来的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', notes: 'Creo contextual proof' },

  { domain: 'AI Agent', utterance: 'AI Agent 如果误判变更影响，我们不知道谁来复核。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', notes: 'AI Agent pain' },
  { domain: 'AI Agent', utterance: 'AI Agent 能不能先帮我们查变更影响，但不要自动写回 PLM？', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', notes: 'AI Agent capability fit' },
  { domain: 'AI Agent', utterance: 'Agent 查 PLM、QMS 和知识库时，权限和工具调用边界怎么打通？', expectedIntent: 'sales_process_integration', expectedAction: 'discovery_question', notes: 'AI Agent integration' },
  { domain: 'AI Agent', utterance: '人工查变更影响太慢，如果 Agent 能先整理证据，评审效率会高很多。', expectedIntent: 'sales_value_discovery', expectedAction: 'discovery_question', notes: 'AI Agent value' },
  { domain: 'AI Agent', utterance: '有没有客户用只读 AI Agent 做 PLM 变更影响分析但保留人工确认的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', notes: 'AI Agent contextual proof' },
];

export const SALES_INDUSTRIAL_NEGATIVE_FIXTURES = [
  { domain: 'PLM', utterance: 'PLM 资料文件名是 Windchill_ECO_case.pdf。', mustNotIntent: ['sales_contextual_proof_discovery'], notes: 'file title only' },
  { domain: 'QMS', utterance: '会议标题是 QMS CAPA 讨论。', mustNotIntent: ['sales_pain_discovery'], notes: 'meeting title only' },
  { domain: 'ERP', utterance: '内部报价表里有 SAP 集成模块价格。', mustNotIntent: ['sales_quote_request'], notes: 'internal pricing doc' },
  { domain: 'MES', utterance: '我们稍后再聊 MES，先休息五分钟。', mustNotIntent: ['sales_capability_fit'], notes: 'defer topic' },
  { domain: 'ALM', utterance: 'ALM 是今天议程第三项，还没开始。', mustNotIntent: ['sales_pain_discovery'], notes: 'agenda only' },
  { domain: '3D design software', utterance: 'Creo 这个词出现在 PPT 标题里。', mustNotIntent: ['sales_capability_fit'], notes: 'single domain token' },
  { domain: 'AI Agent', utterance: 'AI Agent 是我们内部路线图代号。', mustNotIntent: ['sales_capability_fit'], notes: 'internal codename' },
];

export const SALES_INDUSTRIAL_CONFLICT_FIXTURES = [
  { utterance: '先不谈价格，我们要看 PLM/QMS 闭环案例。', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', mustNotIntent: ['sales_pricing_objection', 'sales_quote_request'], notes: 'negated pricing' },
  { utterance: '有没有客户案例？', expectedIntent: 'sales_proof_request', expectedAction: 'case_study_request', mustNotIntent: ['sales_contextual_proof_discovery'], notes: 'generic proof remains old action' },
  { utterance: '有没有类似客户把 Creo 设计变更、Windchill ECO 和 QMS CAPA 打通的案例？', expectedIntent: 'sales_contextual_proof_discovery', expectedAction: 'discovery_question', mustNotIntent: ['sales_proof_request'], notes: 'contextual proof' },
  { utterance: 'API、SSO、生产部署怎么做？', expectedIntent: 'sales_technical_requirements', expectedAction: 'technical_requirements', mustNotIntent: ['sales_capability_fit'], notes: 'technical requirements remain old action' },
  { utterance: '会后发一版报价给我们。', expectedIntent: 'sales_quote_request', expectedAction: 'pricing_request', mustNotIntent: ['sales_value_discovery'], notes: 'quote remains old action' },
  { utterance: '我们准备推进法务和 pilot。', expectedIntent: 'sales_buying_signal', expectedAction: 'buying_signal', mustNotIntent: ['sales_process_integration'], notes: 'buying signal remains old action' },
  { utterance: '这不是要你们承诺功能，我们只是想知道现在 BOM 到 CAPA 的断点在哪里。', expectedIntent: 'sales_pain_discovery', expectedAction: 'discovery_question', mustNotIntent: ['sales_technical_requirements'], notes: 'negated capability promise' },
  { utterance: '我们今天先不谈价格，先搞清楚力学仿真模块的功能是否适合我们的产品，你能不能介绍一下功能和案例。', expectedIntent: 'sales_capability_fit', expectedAction: 'discovery_question', mustNotIntent: ['sales_pricing_objection', 'sales_quote_request'], notes: 'simulation fit example' },
];

export const NON_SALES_INDUSTRIAL_ISOLATION_FIXTURES = [
  { modeTemplateType: 'general', utterance: '解释一下 BOM 变更和质量问题怎么关联。', expectedIntent: 'clarification', expectedAction: 'general_explain', mustNotAction: 'discovery_question', notes: 'general mode explain behavior wins' },
  { modeTemplateType: 'fde', utterance: 'Windchill BOM 变更能不能只读同步到 QMS CAPA 流程里？权限边界怎么验证？', expectedIntent: 'fde_integration', expectedAction: 'fde_integration_check', mustNotAction: 'discovery_question', notes: 'FDE should own manufacturing integration' },
  { modeTemplateType: 'team-meet', utterance: 'MES 现场执行和设计变更不同步，这是本周风险。', expectedIntent: 'capture_risk', expectedAction: 'blocker_check', mustNotAction: 'discovery_question', notes: 'team meeting risk behavior wins' },
  { modeTemplateType: 'recruiting', utterance: '候选人说做过 PLM 和 QMS 集成项目，能不能追问一个具体例子？', expectedIntent: 'request_example', expectedAction: 'candidate_experience_probe', mustNotAction: 'discovery_question', notes: 'recruiting example probe wins' },
  { modeTemplateType: 'lecture', utterance: '老师讲到 CAPA 和 NCR 的质量闭环，解释一下这个概念。', expectedIntent: 'explain_concept', expectedAction: 'concept_explanation', mustNotAction: 'discovery_question', notes: 'lecture concept explanation wins' },
  { modeTemplateType: 'technical-interview', utterance: '这道题要设计一个同步 BOM 和 CAPA 的数据结构。', expectedIntent: 'coding', expectedAction: 'coding_problem', mustNotAction: 'discovery_question', notes: 'technical interview coding behavior wins' },
  { modeTemplateType: 'looking-for-work', utterance: '面试官让我讲一个 Creo、Windchill 和 QMS 销售项目的具体例子。', expectedIntent: 'example_request', expectedAction: 'behavioral_question', mustNotAction: 'discovery_question', notes: 'job-search interview answer behavior wins' },
];

export const SALES_INDUSTRIAL_TIER2_FIXTURES = [
  { utterance: '我们想确认流体仿真模块是否适合电池包冷却液流道。', expectedIntent: 'sales_capability_fit', notes: 'natural capability-fit phrasing should be covered by cloud classifier' },
  { utterance: 'Can this connect Windchill ECO, SAP material master, and QMS CAPA without creating write-back risk?', expectedIntent: 'sales_process_integration', notes: 'English mixed industrial integration should be covered by cloud classifier' },
  { utterance: '先不谈价格，我们要先判断这套 AI Agent 对变更影响分析到底能节省多少评审时间。', expectedIntent: 'sales_value_discovery', notes: 'complex negated pricing plus value discovery should be covered by cloud classifier' },
];
