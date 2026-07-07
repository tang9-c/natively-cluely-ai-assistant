import type { ConversationIntent } from './IntentClassifierShared';

export interface IntentKeywordConfig {
    intent: ConversationIntent;
    keywordsCsv: string;
}

export type IntentKeywordMap = Partial<Record<ConversationIntent, string[]>>;

export const MAX_INTENT_KEYWORDS_CSV_LENGTH = 2000;

const INTERVIEW_KEYWORDS: IntentKeywordConfig[] = [
    { intent: 'clarification', keywordsCsv: 'can you explain,what do you mean,clarify,could you elaborate on that specific,能解释,什么意思,怎么讲,具体说,澄清,说明下,解释一下,怎么理解' },
    { intent: 'follow_up', keywordsCsv: 'what happened,then what,and after that,what.s next,how did that go,后来呢,后来怎样,然后呢,接下来,后来如何,然后怎样,之后呢,结果呢,接下来呢,后来怎么了' },
    { intent: 'deep_dive', keywordsCsv: 'tell me more,dive deeper,explain further,walk me through,how does that work,详细讲,深入讲,展开讲,讲详细点,具体讲讲,解释清楚,讲清楚,细说,细讲,多说一些,再多说,再讲讲,深入解释' },
    { intent: 'behavioral', keywordsCsv: 'give me an example,tell me about a time,describe a situation,when have you,share an experience,举个例子,讲个例子,举一个例子,讲讲你以前,讲讲你当时,你曾经,描述一下当时,讲讲一次,讲讲你过去,讲讲你的经历,有没有类似的例子,讲个故事' },
    { intent: 'example_request', keywordsCsv: 'for example,concrete example,specific instance,like what,such as,比如,例如,具体例子,举个实例,像什么,类似的,像这样的,什么例子,具体说一说,讲个具体例子' },
    { intent: 'summary_probe', keywordsCsv: 'so to summarize,in summary,so basically,so you.re saying,let me make sure,总结一下,概括一下,简单总结,简要说一下,总体来说,总的来说,综上所述,归纳一下,总结下,总结总结' },
    { intent: 'coding', keywordsCsv: 'write code,program,implement,function for,algorithm,how to code,setup a project,using library,debug this,snippet,boilerplate,optimize,refactor,utility method,component for,logic for,写代码,写一下代码,实现一下,解这道题,解一下,代码怎么写,这个算法,怎么实现,实现这个,怎么写,如何实现,调试,优化,重构,怎么优化,怎么调试' },
];

const FDE_KEYWORDS: IntentKeywordConfig[] = [
    { intent: 'fde_discovery', keywordsCsv: 'current workflow,current process,business process,user workflow,stakeholder,requirements,what are you trying to solve,what does success look like,现有流程,当前流程,业务流程,用户流程,需求是什么,想解决什么,谁会使用,谁负责,干系人,业务场景,客户现场' },
    { intent: 'fde_integration', keywordsCsv: 'API,endpoint,webhook,SSO,SAML,OAuth,SCIM,data source,database,warehouse,environment,sandbox,production,staging,integration,API 接口,接口,端点,回调,单点登录,数据源,数据库,数仓,环境,沙盒,生产环境,测试环境,集成,打通' },
    { intent: 'fde_security', keywordsCsv: 'PII,SOC2,compliance,audit log,permission,permissions,access control,data residency,encryption,security review,privacy,PII,合规,审计日志,权限,访问控制,数据驻留,加密,安全评审,隐私,敏感数据,脱敏' },
    { intent: 'fde_risk', keywordsCsv: 'blocker,blocked,dependency,risk,timeline,delay,migration,cutover,rollback,edge case,launch risk,阻塞,卡住,依赖,风险,延期,迁移,切换,回滚,边界情况,上线风险,不确定' },
    { intent: 'fde_agent_feasibility', keywordsCsv: 'AI Agent,agent,automation,human in the loop,human confirmation,approval flow,tool call,read-only,write-back,auto-write,write to PLM,write to QMS,智能体,自动化,人工确认,人审,审批流,工具调用,只读,写回,自动写入,写入 PLM,写入 QMS' },
    { intent: 'fde_success', keywordsCsv: 'success criteria,acceptance criteria,acceptance test,pilot,POC,measurement,metric,KPI,validation,sign off,验收标准,成功标准,试点,验证,指标,度量,KPI,验收测试,通过标准,效果衡量' },
    { intent: 'fde_next_step', keywordsCsv: 'next step,owner,follow up,action item,rollout plan,launch plan,go live,by Friday,by next week,下一步,负责人,跟进,行动项,上线计划,推进计划,灰度,正式上线,周五前,下周,排期' },
];

export const DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE: Record<string, IntentKeywordConfig[]> = {
    general: INTERVIEW_KEYWORDS,
    'looking-for-work': INTERVIEW_KEYWORDS,
    'technical-interview': INTERVIEW_KEYWORDS,
    fde: FDE_KEYWORDS,
    recruiting: [
        { intent: 'request_example', keywordsCsv: 'can you give a specific example,walk me through specifically,do you have an example,a concrete example,for instance,what.s a time when,how did you handle,how did you approach,how did you decide,举一个例子,讲一个例子,具体例子,具体说说,能不能举例,讲讲你当时怎么,你怎么处理的,怎么决定的,给我一个例子' },
        ...INTERVIEW_KEYWORDS,
    ],
    sales: [
        { intent: 'seize_signal', keywordsCsv: 'ready to move,ready to sign,send over the contract,send over the proposal,send the contract,send the proposal,let.s move forward,next steps,finalize,sign the deal,legal review,procurement,when can we start,let.s get started,let.s kick off,let.s schedule,准备签,准备推进,准备敲定,准备开始,发合同,发报价,法务审核,采购流程,下一步怎么走,下一步是,敲定,签合同,推进到,往下走,启动' },
        { intent: 'handle_objection', keywordsCsv: 'too expensive,too pricey,too high,can.t afford,out of our budget,out of my budget,not in the budget,cheaper option,cheaper alternative,discount,price is,reduce the price,competitor,alternative vendor,alternative provider,alternative tool,alternative product,switch from,already using,heard of,do better on price,can you do better,can you lower,can you reduce,太贵,价格高,价格太高,超出预算,预算不够,预算不足,负担不起,能不能便宜,便宜点,打个折,有折扣吗,竞品,竞争对手,别家,其他供应商,听说,为什么不用,考虑一下,对比一下,已经在用' },
        { intent: 'discovery_probe', keywordsCsv: 'what.s the biggest challenge,what.s the main challenge,what.s the primary challenge,what are you trying to solve,what are you trying to achieve,pain point,what.s frustrating,what would need to be true,how do you handle today,walk me through the process,walk me through the workflow,current process,current workflow,ROI,return on investment,payback period,prove the value,prove the ROI,有什么挑战,什么问题,痛点是什么,想解决什么,想达到什么,当前的流程,现在怎么,困扰,为什么要,什么驱动,考察什么,在选什么,需要什么,关注什么,看重什么,遇到什么,流程是怎样的,投资回报,回报率,商业价值,多久回本,怎么衡量效果,效果怎么样,能带来什么,能省多少' },
    ],
    'team-meet': [
        { intent: 'capture_action', keywordsCsv: 'i.ll do,i.ll send,i.ll handle,i.ll own,i.ll take,i.ll follow up,i.ll write,i.ll ship,i.ll PR,i.ll merge,i.m gonna,let me by,action item,to-do,assigned to,owner is,i can have by,by monday,by tuesday,by wednesday,by thursday,by friday,by EOD,by EOW,by next week,我来做,我来发,我来负责,我来处理,我跟进,我写,我来 PR,我提,我合,交给我,我包了,分配给,行动项,待办,跟进项,周五前,周一前,下周三前,今天内,尽快,交付' },
        { intent: 'capture_decision', keywordsCsv: 'we decided,let.s go with,going with,final decision,approved,signed off,greenlit,consensus is,the team agreed,we.re going to use,ship it,merged,locked in,confirmed we,决定了,决定用,决定走,决定采用,就选,就用,就上,定了,通过了,批准了,确认用,最终决定,定下来了,达成一致,大家同意,采用' },
        { intent: 'capture_risk', keywordsCsv: 'blocker,blocked by,blocked on,stuck on,stuck at,risk,at risk,slipping,will miss,behind schedule,dependency on,dependency blocking,waiting on,depends on,not gonna make,impacting timeline,regression,阻塞,被卡,卡住,卡在,风险,延期,推迟,完不成,赶不上,影响进度,依赖,被阻塞,短板,出了点问题' },
        { intent: 'status_update', keywordsCsv: 'where are we,where do we stand,status update,what.s the status,how.s going,any progress on,update on,progress on,current status,where are we on,进度,状态,现在怎样,现在如何,进展,到哪了,卡在哪,进展如何,进度怎么样,谁负责,负责人是谁,预计什么时候,截止日期,时间线,预计交付,ETA' },
    ],
    lecture: [
        { intent: 'explain_concept', keywordsCsv: 'this is called,this is known as,the concept of,the principle of,the idea of,by definition,definition of,introducing,let.s define,we define,theorem of,principle of,the term means,the word means,recall that,这个叫,叫做,所谓的,定义为,引入,概念是,这个概念,术语,意思是,含义,定义,定理,原理,原则' },
        { intent: 'render_formula', keywordsCsv: 'equation,formula,theorem says,lemma,corollary,proof,derivation,derive,integral,sum of,product of,limit of,matrix,vector,公式,方程,定理,引理,推论,证明,推导,积分,求和,连乘,极限,矩阵,向量,等于,式子,表达式' },
        { intent: 'answer_class_question', keywordsCsv: 'anyone know,who can tell,what is the answer,does anyone,can anyone tell,can anyone explain,raise your hand,class,any volunteers,谁知道,谁来答,有人知道,有没有人,谁能说一下,举手,哪位同学,请回答,答案是什么,怎么算,怎么解' },
    ],
};

export const INTENT_MATCH_ORDER_BY_TEMPLATE: Record<string, ConversationIntent[]> = {
    general: ['clarification', 'follow_up', 'deep_dive', 'behavioral', 'example_request', 'summary_probe', 'coding'],
    'looking-for-work': ['clarification', 'follow_up', 'deep_dive', 'behavioral', 'example_request', 'summary_probe', 'coding'],
    'technical-interview': ['clarification', 'follow_up', 'deep_dive', 'behavioral', 'example_request', 'summary_probe', 'coding'],
    fde: ['fde_security', 'fde_risk', 'fde_agent_feasibility', 'fde_next_step', 'fde_integration', 'fde_success', 'fde_discovery'],
    recruiting: ['request_example', 'clarification', 'follow_up', 'deep_dive', 'behavioral', 'example_request', 'summary_probe', 'coding'],
    sales: ['seize_signal', 'handle_objection', 'discovery_probe'],
    'team-meet': ['capture_action', 'capture_decision', 'capture_risk', 'status_update'],
    lecture: ['explain_concept', 'render_formula', 'answer_class_question'],
};

export const VALID_INTENT_KEYWORD_INTENTS: ReadonlySet<ConversationIntent> = new Set(
    Object.values(INTENT_MATCH_ORDER_BY_TEMPLATE).flat(),
);

export function isValidIntentKeywordIntent(intent: string): intent is ConversationIntent {
    return VALID_INTENT_KEYWORD_INTENTS.has(intent as ConversationIntent);
}

export function normalizeIntentKeywordsCsv(csv: string): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const raw of csv.split(',')) {
        const keyword = raw.trim();
        if (!keyword) continue;
        const key = keyword.toLocaleLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(keyword);
    }
    return result;
}

export function keywordRowsToMap(rows: IntentKeywordConfig[]): IntentKeywordMap {
    const map: IntentKeywordMap = {};
    for (const row of rows) {
        map[row.intent] = normalizeIntentKeywordsCsv(row.keywordsCsv);
    }
    return map;
}

export function defaultKeywordRowsForTemplate(modeTemplateType: string | null | undefined): IntentKeywordConfig[] {
    return DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE[modeTemplateType ?? 'general']
        ?? DEFAULT_INTENT_KEYWORDS_BY_TEMPLATE.general;
}

export function defaultKeywordMapForTemplate(modeTemplateType: string | null | undefined): IntentKeywordMap {
    return keywordRowsToMap(defaultKeywordRowsForTemplate(modeTemplateType));
}

export function matchIntentKeywords(
    text: string,
    modeTemplateType: string | null | undefined,
    keywordMap: IntentKeywordMap,
): ConversationIntent | null {
    const normalizedText = text.toLocaleLowerCase();
    const order = INTENT_MATCH_ORDER_BY_TEMPLATE[modeTemplateType ?? 'general']
        ?? INTENT_MATCH_ORDER_BY_TEMPLATE.general;
    for (const intent of order) {
        const keywords = keywordMap[intent] ?? [];
        for (const keyword of keywords) {
            if (normalizedText.includes(keyword.toLocaleLowerCase())) {
                return intent;
            }
        }
    }
    return null;
}
