export interface ActionTrigger {
    type: string;
    patterns: RegExp[];
    priority: number;
    label: string;
    promptInstruction: string;
    answerStyle?: {
        maxWords: number;
        format: 'bullets' | 'short_script' | 'code' | 'checklist' | 'summary' | 'email';
        tone: string;
    };
}

const zh = (...terms: string[]): RegExp => new RegExp(terms.join('|'), 'i');

const GENERAL_TRIGGERS: ActionTrigger[] = [
    {
        type: 'general_assistance_request',
        patterns: [
            /\b(can you help me|help me with|what should I say|how should I respond|how do I answer)\b/i,
            zh('帮我想一下', '我该怎么说', '我该怎么回答', '怎么回应', '怎么答'),
        ],
        priority: 0.82,
        label: 'Suggest response',
        promptInstruction:
            'You are in General mode. The user needs help responding. Provide a concise, context-aware answer they can say out loud.',
        answerStyle: { maxWords: 100, format: 'short_script', tone: 'helpful' },
    },
    {
        type: 'general_summarize',
        patterns: [
            /\b(summarize this|recap this|quick summary|what did they say|what was decided)\b/i,
            zh('总结一下', '复盘一下', '简单总结', '他们刚才说了什么', '刚才决定了什么'),
        ],
        priority: 0.78,
        label: 'Summarize discussion',
        promptInstruction:
            'You are in General mode. Summarize the relevant discussion into the fewest useful bullets.',
        answerStyle: { maxWords: 90, format: 'bullets', tone: 'neutral' },
    },
    {
        type: 'general_explain',
        patterns: [
            /\b(explain that|what does that mean|break that down|in simple terms)\b/i,
            zh('解释一下', '这是什么意思', '拆解一下', '简单说', '通俗一点'),
        ],
        priority: 0.76,
        label: 'Explain clearly',
        promptInstruction:
            'You are in General mode. Explain the current topic plainly and avoid inventing details not present in context.',
        answerStyle: { maxWords: 120, format: 'bullets', tone: 'clear' },
    },
];

const NEGOTIATION_TRIGGERS: ActionTrigger[] = [
    {
        type: 'budget_probe',
        patterns: [
            /\b(what'?s your budget|budget range|target price|price range|how much can you spend)\b/i,
            zh('预算是多少', '预算范围', '目标价格', '价格范围', '能花多少钱'),
        ],
        priority: 0.88,
        label: 'Handle budget probe',
        promptInstruction:
            'You are in Negotiation mode. Respond to a budget probe without anchoring too low. Ask a calibrated question and protect leverage.',
        answerStyle: { maxWords: 90, format: 'short_script', tone: 'calm' },
    },
    {
        type: 'price_pushback',
        patterns: [
            /\b(price is too high|too expensive|can you do better|lower the price|discount|cheaper)\b/i,
            zh('价格太高', '太贵', '能不能便宜', '降价', '折扣', '优惠'),
        ],
        priority: 0.9,
        label: 'Counter price pushback',
        promptInstruction:
            'You are in Negotiation mode. The other side is pushing on price. Defend value, trade concessions for commitments, and avoid unilateral discounting.',
        answerStyle: { maxWords: 100, format: 'short_script', tone: 'firm' },
    },
    {
        type: 'final_offer',
        patterns: [
            /\b(final offer|best and final|take it or leave it|last offer|walk away)\b/i,
            zh('最终报价', '最后报价', '一口价', '接受就接受', '不接受就算了', '只能这样'),
        ],
        priority: 0.92,
        label: 'Respond to final offer',
        promptInstruction:
            'You are in Negotiation mode. Respond to a final-offer frame by testing constraints, preserving optionality, and proposing a concrete next move.',
        answerStyle: { maxWords: 90, format: 'short_script', tone: 'composed' },
    },
];

// Sales triggers
const SALES_TRIGGERS: ActionTrigger[] = [
    {
        type: 'pricing_objection',
        patterns: [
            /\b(expensive|too pricey|price (?:is|seems|looks|feels) (?:a bit |really |too )?(?:high|expensive)|pricing (?:is|seems|looks|feels) (?:a bit |really |too )?(?:high|expensive)|cost (?:is|seems|looks|feels) (?:a bit |really |too )?(?:high|expensive)|too much|out of (?:our|my|the) budget|not in (?:our|my|the) budget|can't afford|cannot afford|do better on price|lower the price|reduce the price|discount)\b/i,
            zh('太贵', '价格高', '价格太高', '报价太高', '预算不够', '预算不足', '预算.{0,8}过不了', '年付.{0,12}预算.{0,8}过不了', '太高.{0,12}预算', '成本', '费用', '负担不起'),
        ],
        priority: 0.9,
        label: 'Handle pricing objection',
        promptInstruction:
            'You are in Sales mode. The prospect raised a pricing or budget objection. Generate 1-3 sentences the seller can say aloud. Start by acknowledging the concern, do not list generic value points, do not invent ROI, discount, price, customer names, or terms, and end with one forward question.',
        answerStyle: { maxWords: 80, format: 'short_script', tone: 'confident' },
    },
    {
        type: 'buying_signal',
        patterns: [
            /\b(ready to move|ready to sign|send contract|legal review|next steps|schedule|finalize|pilot|trial|procurement|sign the deal)\b/i,
            // Debug session 2026-06-23: bare `准备签` (e.g. "我们准备签合同了")
            // wasn't in the alternation; only `准备推进` matched. Common close-to-
            // closing phrasing like 准备签 / 准备签合同 / 准备签一下 slipped past.
            zh('准备签', '准备推进', '想推进到', '推进到.{0,6}法务.{0,4}审核', '推进到.{0,6}放假.{0,4}审核', '发合同', '法务审核', '放假审核', '下一步', '安排时间', '敲定'),
        ],
        priority: 0.95,
        label: 'Seize buying signal',
        promptInstruction:
            'You are in Sales mode. The prospect showed buying or next-step intent. Lock next step, owner, date, and artifact. If owner/date/artifact is missing, ask for the missing field instead of inventing it.',
        answerStyle: { maxWords: 90, format: 'short_script', tone: 'enthusiastic' },
    },
    {
        type: 'pricing_request',
        patterns: [
            /\b(send me pricing|pricing page|quote|proposal|commercials|what does it cost)\b/i,
            zh('发我报价', '发.{0,6}报价', '给.{0,6}报价', '报(?:个|一下|下)价(?:格)?', '给(?:我)?(?:个|一下|下)价(?:格)?', '报价单', '价格页', '方案报价', '商务条款', '多少钱'),
        ],
        priority: 0.86,
        label: 'Draft quote email',
        promptInstruction:
            'You are in Sales mode. The prospect asked for a quote, proposal, pricing, or commercial terms. Generate an email draft with greeting, short body, and sign-off. Use [CUSTOMER_NAME], [QUOTE_AMOUNT], [SCOPE], and [NEXT_STEP] unless exact trusted context provides values. Do not invent pricing, customer names, account numbers, contract terms, or commercial terms.',
        answerStyle: { maxWords: 160, format: 'email', tone: 'consultative' },
    },
    {
        type: 'case_study_request',
        patterns: [
            /\b(case study|customer story|customer example|reference customer|proof point|success story|similar customer|implementation example|ROI|return on investment)\b/i,
            zh('客户案例', '成功案例', '案例', '标杆客户', '参考客户', '类似客户', '落地案例', '实施案例', '证明材料', '投资回报', '回报率'),
        ],
        priority: 0.87,
        label: 'Share relevant case study',
        promptInstruction:
            'You are in Sales mode. The prospect asked for a case study, similar customer, ROI, or proof. Use uploaded/reference/trusted context first. If no grounded case or proof is present, say that the provided materials do not include a matching proof point and ask what proof would be useful. Do not invent customer names, metrics, outcomes, or ROI.',
        answerStyle: { maxWords: 120, format: 'bullets', tone: 'credible' },
    },
    {
        type: 'technical_requirements',
        patterns: [
            /\b(technical requirements?|technical needs?|integration requirements?|API requirements?|security requirements?|deployment requirements?|implementation details?|technical solution|architecture requirements?|SSO requirements?)\b/i,
            zh('技术需求', '技术要求', '集成需求', '集成要求', '接口需求', 'API 需求', '部署要求', '安全要求', '技术方案', '实现细节', '对接方式', '架构要求', 'SSO 对接'),
        ],
        priority: 0.88,
        label: 'Clarify technical requirements',
        promptInstruction:
            'You are in Sales mode. The prospect raised technical, security, API, SSO, integration, or deployment requirements. Clarify systems, APIs, auth, deployment environment, security constraints, owners, and the smallest validation step. Do not promise capability before validation.',
        answerStyle: { maxWords: 140, format: 'checklist', tone: 'technical' },
    },
];

// Recruiting triggers
const RECRUITING_TRIGGERS: ActionTrigger[] = [
    {
        type: 'candidate_concern',
        patterns: [
            /\b(visa|relocation|compensation|offer|start date|security|remote|hybrid)\b/i,
            zh('签证', '搬迁', '薪资', 'offer', '入职时间', '安全审查', '远程', '混合办公'),
        ],
        priority: 0.85,
        label: 'Address candidate concern',
        promptInstruction:
            'You are in Recruiting mode. The candidate has raised a concern. Address it factually and empathetically.',
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'empathetic' },
    },
    {
        type: 'strong_fit_signal',
        patterns: [
            /\b(excited|love this|exactly what|great fit|perfect match)\b/i,
            zh('很感兴趣', '很喜欢', '正好符合', '很匹配', '非常适合'),
        ],
        priority: 0.9,
        label: 'Reinforce positive signal',
        promptInstruction:
            "You are in Recruiting mode. The candidate is showing strong interest. Reinforce why this role is a great match.",
        answerStyle: { maxWords: 60, format: 'bullets', tone: 'encouraging' },
    },
    {
        type: 'candidate_experience_probe',
        patterns: [
            /\b(tell me about your experience|walk me through your background|why this role|why are you interested|specific example|concrete example|give me an example)\b/i,
            zh('讲讲你的经验', '介绍一下你的背景', '为什么这个岗位', '为什么感兴趣', '具体的例子', '举个具体例子', '举一个具体例子', '举一个例子'),
        ],
        priority: 0.84,
        label: 'Guide candidate story',
        promptInstruction:
            'You are in Recruiting mode. Help assess and guide the candidate response around experience, motivation, and fit.',
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'structured' },
    },
];

// Team Meeting triggers
const TEAM_TRIGGERS: ActionTrigger[] = [
    {
        type: 'action_item',
        patterns: [
            /\b(I'll do|I'll send|need to follow up|action item|assigned to|deadline|by Friday|by Monday)\b/i,
            zh('我来做', '我会发', '需要跟进', '行动项', '分配给', '截止', '周五前', '周一前'),
        ],
        priority: 0.9,
        label: 'Capture action item',
        promptInstruction:
            'You are in Team Meeting mode. Extract the action item: who will do what by when.',
        answerStyle: { maxWords: 50, format: 'bullets', tone: 'direct' },
    },
    {
        type: 'decision_point',
        patterns: [
            /\b(decided|going with|let's go|final decision|approved|confirmed)\b/i,
            zh('决定了', '就选', '我们定', '最终决定', '批准', '确认'),
        ],
        priority: 0.85,
        label: 'Confirm decision',
        promptInstruction: 'You are in Team Meeting mode. Summarize the decision that was made.',
        answerStyle: { maxWords: 40, format: 'bullets', tone: 'neutral' },
    },
    {
        type: 'blocker_check',
        patterns: [
            /\b(any blockers|blocked by|stuck on|risk to timeline|what'?s blocking|what is blocking|dependency|waiting on|depends on|cannot proceed|blocked until|stalled because|needs approval from)\b/i,
            zh('有什么阻塞', '被卡住', '卡在哪', '风险', '依赖', '影响进度', '等.*确认', '等.*审批', '没有.*就推进不了', '需要.*支持', '依赖.*完成'),
        ],
        priority: 0.84,
        label: 'Clarify blocker',
        promptInstruction:
            'You are in Team Meeting mode. Identify the blocker, owner, impact, and next unblock step.',
        answerStyle: { maxWords: 70, format: 'checklist', tone: 'direct' },
    },
    {
        type: 'owner_deadline_check',
        patterns: [
            /\b(who owns this|owner for this|by when|timeline|ETA|due date|due by|due on|deadline is|target date|ship date|commit by|before EOD|before end of week)\b/i,
            zh('谁负责', '负责人是谁', '什么时候', '时间线', '预计什么时候', '截止日期', '本周内', '这周内', '下周前', '月底前', '今天下班前', '明天中午前', '截止到', '交付时间'),
        ],
        priority: 0.83,
        label: 'Lock owner and deadline',
        promptInstruction:
            'You are in Team Meeting mode. Turn the discussion into an explicit owner, deliverable, and deadline.',
        answerStyle: { maxWords: 60, format: 'checklist', tone: 'direct' },
    },
];

// Interview triggers
const INTERVIEW_TRIGGERS: ActionTrigger[] = [
    {
        type: 'behavioral_question',
        patterns: [
            /\b(tell me about a time|describe a situation|STAR|leadership|challenge|succeeded|failed)\b/i,
            zh('讲一个例子', '描述一次', 'STAR', '领导力', '挑战', '成功', '失败'),
        ],
        priority: 0.9,
        label: 'Answer with STAR story',
        promptInstruction:
            'You are in Interview mode. The interviewer asked a behavioral question. Structure your answer using the STAR method (Situation, Task, Action, Result) with specific metrics.',
        answerStyle: { maxWords: 200, format: 'short_script', tone: 'confident' },
    },
    {
        type: 'intro_pitch',
        patterns: [
            /\b(tell me about yourself|walk me through your resume|introduce yourself)\b/i,
            zh('介绍一下你自己', '讲讲你的简历', '自我介绍', '介绍你的经历'),
        ],
        priority: 0.88,
        label: 'Craft intro pitch',
        promptInstruction:
            'You are in Interview mode. Create a crisp candidate intro that connects background, strengths, and why this role fits.',
        answerStyle: { maxWords: 160, format: 'short_script', tone: 'confident' },
    },
    {
        type: 'company_motivation',
        patterns: [
            /\b(why this company|why do you want to work here|why us|what interests you about us)\b/i,
            zh('为什么我们公司', '为什么想来', '为什么选择我们', '对我们哪里感兴趣'),
        ],
        priority: 0.86,
        label: 'Answer company motivation',
        promptInstruction:
            'You are in Interview mode. Answer why this company using concrete signals from the conversation and avoid generic flattery.',
        answerStyle: { maxWords: 140, format: 'short_script', tone: 'authentic' },
    },
    {
        type: 'weakness_question',
        patterns: [
            /\b(strengths and weaknesses|biggest weakness|area for improvement|weakness)\b/i,
            // Debug session 2026-06-23: bare `缺点` (the canonical "what's your
            // weakness?" opener in Chinese interviews) wasn't in the alternation;
            // only the longer phrases like `优缺点` / `最大的缺点` matched.
            // `你的最大缺点是什么?` and `讲讲你的缺点` slipped past, missing the
            // most common Chinese weakness-question phrasing.
            zh('缺点', '优缺点', '最大的缺点', '需要改进', '短板', '不足'),
        ],
        priority: 0.84,
        label: 'Handle weakness question',
        promptInstruction:
            'You are in Interview mode. Answer the weakness question honestly with a real mitigation and evidence of progress.',
        answerStyle: { maxWords: 140, format: 'short_script', tone: 'reflective' },
    },
];

// Lecture triggers
const LECTURE_TRIGGERS: ActionTrigger[] = [
    {
        type: 'concept_explanation',
        patterns: [
            /\b(this is called|definition|define|formula|theorem|principle|concept|explain the concept)\b/i,
            zh('这个叫', '定义', '公式', '定理', '原则', '概念', '解释这个概念'),
        ],
        priority: 0.85,
        label: 'Explain concept',
        promptInstruction:
            'You are in Lecture mode. Explain the concept clearly with a practical example.',
        answerStyle: { maxWords: 150, format: 'bullets', tone: 'educational' },
    },
    {
        type: 'worked_example',
        patterns: [
            /\b(example of|for example|worked example|sample problem|practice problem)\b/i,
            zh('举个例子', '比如', '例题', '样例题', '练习题'),
        ],
        priority: 0.82,
        label: 'Create worked example',
        promptInstruction:
            'You are in Lecture mode. Turn the concept into a worked example with steps and the intuition behind each step.',
        answerStyle: { maxWords: 180, format: 'bullets', tone: 'educational' },
    },
];

// Technical Interview triggers
const TECHNICAL_TRIGGERS: ActionTrigger[] = [
    {
        type: 'coding_problem',
        patterns: [
            /\b(implement|write code|solve|function|algorithm|data structure)\b/i,
            zh('实现', '写代码', '解这道题', '函数', '算法', '数据结构'),
        ],
        priority: 0.95,
        label: 'Solve coding problem',
        promptInstruction:
            'You are in Technical Interview mode. Provide a clear, efficient solution with time/space complexity analysis.',
        answerStyle: { maxWords: 300, format: 'code', tone: 'analytical' },
    },
    {
        type: 'screen_coding_problem',
        patterns: [
            /\b(screen|visible|shown|popup|error message|output|on screen)\b/i,
            zh('屏幕', '能看到', '显示', '弹窗', '错误信息', '输出', '画面上'),
        ],
        priority: 0.92,
        label: 'Answer from screen',
        promptInstruction:
            'You are in Technical Interview mode. A coding problem is visible on the screen. Read the visible problem carefully and provide a solution.',
    },
    {
        type: 'complexity_analysis',
        patterns: [
            /\b(time complexity|space complexity|big o|runtime|optimize|more efficient)\b/i,
            zh('时间复杂度', '空间复杂度', '大O', '运行时间', '优化', '更高效'),
        ],
        priority: 0.9,
        label: 'Analyze complexity',
        promptInstruction:
            'You are in Technical Interview mode. Explain the complexity tradeoff clearly and suggest the next optimization path.',
        answerStyle: { maxWords: 180, format: 'bullets', tone: 'analytical' },
    },
    {
        type: 'system_design_prompt',
        patterns: [
            /\b(design a system|system design|architecture|scale to|distributed|throughput)\b/i,
            zh('设计一个系统', '系统设计', '架构', '扩展到', '分布式', '吞吐量'),
        ],
        priority: 0.89,
        label: 'Structure system design',
        promptInstruction:
            'You are in Technical Interview mode. Structure the system design answer around requirements, APIs, data model, scaling, and tradeoffs.',
        answerStyle: { maxWords: 260, format: 'bullets', tone: 'analytical' },
    },
];

const FDE_TRIGGERS: ActionTrigger[] = [
    {
        type: 'fde_security_review',
        patterns: [
            /\b(PII|SOC2|compliance|audit logs?|permissions?|access control|data residency|encryption|security review|privacy)\b/i,
            zh('合规', '审计日志', '权限', '访问控制', '数据驻留', '加密', '安全评审', '隐私', '敏感数据', '脱敏'),
        ],
        priority: 0.92,
        label: 'Clarify security review',
        promptInstruction:
            'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. The customer raised security, privacy, compliance, auditability, permission, or quality-record concerns. Identify the PLM/QMS object or data involved, system-permission risk, required reviewer, human confirmation point, and validation artifact.',
        answerStyle: { maxWords: 120, format: 'checklist', tone: 'precise' },
    },
    {
        type: 'fde_risk_blocker',
        patterns: [
            /\b(blocker|blocked|dependency|risk|timeline|delay|migration|cutover|rollback|edge case|launch risk|NCR|CAPA|8D|non-conformance|traceability|quality|audit)\b/i,
            zh('阻塞', '卡住', '依赖', '风险', '延期', '迁移', '切换', '回滚', '边界情况', '上线风险', '不确定', 'NCR', 'CAPA', '8D', '质量', '追溯', '审计', '偏差'),
        ],
        priority: 0.9,
        label: 'Unblock deployment risk',
        promptInstruction:
            'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. A delivery risk or blocker was raised. Split the risk into customer-process risk, system-permission risk, delivery risk, AI Agent error risk, or missing information. State impact, dependency, owner if present, date if present, and the smallest validation artifact to unblock.',
        answerStyle: { maxWords: 110, format: 'checklist', tone: 'direct' },
    },
    {
        type: 'fde_agent_feasibility',
        patterns: [
            /\b(agent|AI agent|automation|human in the loop|approval flow|tool call|read[- ]?only|write back|auto[- ]?write|write to PLM|write to QMS)\b/i,
            zh('智能体', 'AI Agent', '自动化', '人审', '人工确认', '审批流', '工具调用', '只读', '写回', '自动写入', '写入 PLM', '写入 QMS'),
        ],
        priority: 0.87,
        label: 'Assess AI Agent feasibility',
        promptInstruction:
            'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Identify what can be suggested by AI, what requires human confirmation, what must remain read-only, and which human-reviewed approval-flow recommendations need owner/date/artifact validation. Do not imply automatic writes, approvals, or updates to PLM or QMS.',
        answerStyle: { maxWords: 120, format: 'checklist', tone: 'conservative' },
    },
    {
        type: 'fde_next_step',
        patterns: [
            /\b(next step|owner|follow up|action item|rollout plan|launch plan|go live|by Friday|by next week)\b/i,
            zh('下一步', '负责人', '跟进', '行动项', '上线计划', '推进计划', '灰度', '正式上线', '周五前', '下周'),
        ],
        priority: 0.9,
        label: 'Lock next step',
        promptInstruction:
            'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Convert the discussion into owner, deliverable, date, validation artifact, test data, and acceptance criteria. Ask directly for any missing owner/date/artifact field instead of inventing it.',
        answerStyle: { maxWords: 90, format: 'checklist', tone: 'direct' },
    },
    {
        type: 'fde_integration_check',
        patterns: [
            /\b(API|endpoint|webhook|SSO|SAML|OAuth|SCIM|data source|database|warehouse|environment|sandbox|production|staging|integration)\b/i,
            zh('API 接口', '接口', '端点', '回调', '单点登录', '数据源', '数据库', '数仓', '环境', '沙盒', '生产环境', '测试环境', '集成', '打通'),
        ],
        priority: 0.88,
        label: 'Clarify integration',
        promptInstruction:
            'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Clarify source system, target system, auth/SSO method, role/permission model, data direction, read/write boundary, environment, owner, date, and validation artifact.',
        answerStyle: { maxWords: 120, format: 'checklist', tone: 'technical' },
    },
    {
        type: 'fde_success_criteria',
        patterns: [
            /\b(success criteria|acceptance criteria|acceptance test|pilot|POC|measurement|metric|KPI|validation|sign off)\b/i,
            zh('验收标准', '成功标准', '试点', '验证', '指标', '度量', 'KPI', '验收测试', '通过标准', '效果衡量'),
        ],
        priority: 0.86,
        label: 'Define success criteria',
        promptInstruction:
            'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Convert the validation discussion into acceptance criteria covering accuracy, permission boundary, human confirmation point, audit traceability, test data, owner, date, and validation artifact.',
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'structured' },
    },
    {
        type: 'fde_discovery_probe',
        patterns: [
            /\b(current workflow|current process|business process|user workflow|stakeholder|requirements|what are you trying to solve|what does success look like|PLM|BOM|ECO|ECN|revision|version|release|part number|drawing|material master|routing|manufacturing)\b/i,
            zh('现有流程', '当前流程', '业务流程', '用户流程', '需求是什么', '想解决什么', '谁会使用', '谁负责', '干系人', '业务场景', '客户现场', 'PLM', 'BOM', 'ECO', 'ECN', '版本', '变更单', '发布', '图纸', '物料', '工艺'),
        ],
        priority: 0.84,
        label: 'Probe deployment context',
        promptInstruction:
            'You are in FDE mode for manufacturing PLM / QMS / enterprise AI Agent deployment. Ask 3 manufacturing-process clarification questions about the workflow, system object such as BOM/ECO/ECN/CAPA/NCR/8D, stakeholder, permission boundary, and validation artifact.',
        answerStyle: { maxWords: 100, format: 'bullets', tone: 'curious' },
    },
];

export const MODE_TRIGGERS: Record<string, ActionTrigger[]> = {
    general: GENERAL_TRIGGERS,
    negotiation: NEGOTIATION_TRIGGERS,
    sales: SALES_TRIGGERS,
    fde: FDE_TRIGGERS,
    recruiting: RECRUITING_TRIGGERS,
    'team-meet': TEAM_TRIGGERS,
    team_meeting: TEAM_TRIGGERS,
    'looking-for-work': INTERVIEW_TRIGGERS,
    interview: INTERVIEW_TRIGGERS,
    lecture: LECTURE_TRIGGERS,
    'technical-interview': TECHNICAL_TRIGGERS,
    technical_interview: TECHNICAL_TRIGGERS,
};

function shouldSuppressSalesTrigger(trigger: ActionTrigger, transcript: string, speaker?: string): boolean {
    const text = transcript.replace(/\s+/g, ' ').trim();
    if (
        /^(internal|internal teammate|teammate|me|host)$/i.test((speaker ?? '').trim()) &&
        ['pricing_objection', 'pricing_request', 'case_study_request', 'technical_requirements', 'buying_signal'].includes(trigger.type)
    ) {
        return true;
    }
    if (trigger.type === 'case_study_request') {
        return /内部复盘|不是客户要材料|file name is outdated|our drive|材料还没上传|先别引用/i.test(text);
    }
    if (trigger.type === 'buying_signal') {
        return /later internal topic|no customer ask|主持人切换议程|切换议程/i.test(text);
    }
    if (trigger.type === 'technical_requirements') {
        return /(internal folder|internal file|our drive|内部文件夹|内部资料|内部核对|内部复盘|不是客户在问|不是客户要|no customer ask|not a customer ask|客户身份错配|identity mismatch|文件夹里的方案标题)/i.test(text);
    }
    return false;
}

function shouldSuppressFdeTrigger(trigger: ActionTrigger, transcript: string): boolean {
    const text = transcript.replace(/\s+/g, ' ').trim();
    if (!text) return true;
    if (/(午饭|吃什么|天气|闲聊|random chat)/i.test(text)) return true;
    if (/(内部复盘|我们内部|内部待办|internal note|internal planning|draft wording|not a customer ask)/i.test(text)) return true;
    if (/(只是(?:文件名|提到)|文件名|材料名|不是客户流程|不是集成需求|不是要查|没有客户问题|没有新证据|没人提问|not about deployment|only in (?:our )?slide title|attendee title only)/i.test(text)) return true;
    if (/(上周话题|old topic|still joining the call|还在加入会议|测试麦克风)/i.test(text)) return true;
    if (
        trigger.type === 'fde_discovery_probe' &&
        !/(客户|customer|PLM|QMS|BOM|ECO|ECN|CAPA|NCR|8D|流程|权限|验收|集成|AI Agent|智能体|物料|图纸|变更|质量)/i.test(text)
    ) {
        return true;
    }
    return false;
}

function shouldSuppressTeamTrigger(trigger: ActionTrigger, transcript: string): boolean {
    const text = transcript.replace(/\s+/g, ' ').trim();
    if (!text) return true;
    if (/(报价表|pricing sheet|sales quote|客户报价)/i.test(text)) return true;
    if (trigger.type === 'decision_point' && /(只是候选项|还没有决定|只是讨论|方案之一|option only|not decided|no decision today|brainstorm)/i.test(text)) return true;
    if (trigger.type === 'owner_deadline_check' && /(公司活动|不是交付截止时间|not .*deadline|not .*due date)/i.test(text)) return true;
    if (trigger.type === 'blocker_check' && /(包管理器日志|不是项目阻塞|slide title|nobody raised a blocker)/i.test(text)) return true;
    if (trigger.type === 'action_item' && /(not committing to an action item|不会承诺行动项|只是想想|公司活动|不是交付截止时间)/i.test(text)) return true;
    if (/(闲聊|午饭|天气|random chat|等大家进会议)/i.test(text)) return true;
    return false;
}

export class DynamicActionDetector {
    private triggers: Record<string, ActionTrigger[]>;

    constructor(triggers: Record<string, ActionTrigger[]> = MODE_TRIGGERS) {
        this.triggers = triggers;
    }

    detectTriggers(params: {
        transcript: string;
        modeTemplateType: string;
        speaker?: string;
    }): Array<{ trigger: ActionTrigger; match: string; index: number }> {
        const { transcript, modeTemplateType, speaker } = params;
        const matchedTriggers: Array<{ trigger: ActionTrigger; match: string; index: number }> = [];

        // Get triggers for this mode, fallback to empty array
        const modeTriggers = this.triggers[modeTemplateType] || [];

        for (const trigger of modeTriggers) {
            if (modeTemplateType === 'sales' && shouldSuppressSalesTrigger(trigger, transcript, speaker)) {
                continue;
            }
            if (modeTemplateType === 'fde' && shouldSuppressFdeTrigger(trigger, transcript)) {
                continue;
            }
            if ((modeTemplateType === 'team-meet' || modeTemplateType === 'team_meeting') && shouldSuppressTeamTrigger(trigger, transcript)) {
                continue;
            }
            for (const pattern of trigger.patterns) {
                const match = pattern.exec(transcript);
                if (match) {
                    matchedTriggers.push({
                        trigger,
                        match: match[0],
                        index: match.index,
                    });
                    break; // Only use first matching pattern per trigger
                }
            }
        }

        return matchedTriggers;
    }

    getTriggerForType(type: string): ActionTrigger | undefined {
        for (const triggers of Object.values(this.triggers)) {
            const found = triggers.find((t) => t.type === type);
            if (found) return found;
        }
        return undefined;
    }
}
