import type {
  ScenarioAdapter,
  ScenarioCardDefinition,
  ScenarioDocSubtype,
  ScenarioDocument,
  ScenarioResolution,
  ScenarioType,
} from './types';

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return char;
    }
  });
}

function formatDocumentContext(scenarioType: ScenarioType, document: ScenarioDocument): string {
  const attributes = [
    `scenario="${escapeXml(scenarioType)}"`,
    `subtype="${escapeXml(document.subtype)}"`,
  ];

  if (document.title) {
    attributes.push(`title="${escapeXml(document.title)}"`);
  }

  if (document.source) {
    attributes.push(`source="${escapeXml(document.source)}"`);
  }

  return [
    `<scenario-document ${attributes.join(' ')}>`,
    escapeXml(document.content),
    '</scenario-document>',
  ].join('\n');
}

function card(
  id: string,
  title: string,
  description: string,
  docSubtype: ScenarioDocSubtype,
  componentKey: ScenarioCardDefinition['componentKey'] = docSubtype === 'references' || docSubtype === 'context-note'
    ? 'reference-materials'
    : 'scenario-summary',
): ScenarioCardDefinition {
  return { id, title, description, docSubtype, componentKey };
}

function createAdapter(params: {
  type: ScenarioType;
  label: string;
  supportedDocSubtypes: ScenarioDocSubtype[];
  cards: ScenarioCardDefinition[];
  systemPromptSuffix: string | ((resolution: ScenarioResolution) => string);
}): ScenarioAdapter {
  return {
    type: params.type,
    label: params.label,
    supportedDocSubtypes: params.supportedDocSubtypes,
    cards: params.cards,
    dataScopes: ['reference_files'],
    getSystemPromptSuffix: (resolution) =>
      typeof params.systemPromptSuffix === 'function'
        ? params.systemPromptSuffix(resolution)
        : params.systemPromptSuffix,
    formatDocumentContext: (document) => formatDocumentContext(params.type, document),
  };
}

export const salesScenarioAdapter = createAdapter({
  type: 'sales',
  label: '销售',
  supportedDocSubtypes: [
    'customer-profile',
    'product-intro',
    'solution-brief',
    'case-study',
    'pricing-objections',
  ],
  cards: [
    card('customer-profile', '客户档案', '潜在客户背景、关键干系人、痛点与采购语境。', 'customer-profile'),
    card('product-intro', '产品介绍', '产品定位、核心能力与演示要点。', 'product-intro'),
    card('solution-brief', '方案简介', '推荐方案形态与价值证明。', 'solution-brief'),
    card('case-study', '客户案例', '相关客户证据与落地成果。', 'case-study'),
    card('pricing-objections', '定价与异议', '价格、采购流程与异议处理话术。', 'pricing-objections'),
  ],
  systemPromptSuffix: 'You are helping the user in a sales scenario. Use customer, product, solution, case study, pricing, and objection materials as grounding context.',
});

export const interviewScenarioAdapter = createAdapter({
  type: 'interview',
  label: '面试',
  supportedDocSubtypes: [
    'candidate-profile',
    'candidate-resume',
    'job-description',
    'company-research',
    'negotiation-script',
    'scorecard',
    'followup-script',
    'technical-spec',
    'rubric',
    'practice-problem',
  ],
  cards: [
    card('candidate-profile', '候选人档案', '候选人背景、目标、优势与定位说明。', 'candidate-profile'),
    card('candidate-resume', '候选人简历', '候选人简历、工作经历与经验佐证。', 'candidate-resume'),
    card('job-description', '职位描述', '岗位要求、职责与评估标准。', 'job-description'),
    card('company-research', '公司调研', '公司、团队、产品与行业背景。', 'company-research'),
    card('negotiation-script', '谈判话术', '薪酬、 offer 与谈判要点。', 'negotiation-script'),
    card('scorecard', '评分卡', '评估维度、胜任力与打分指引。', 'scorecard'),
    card('followup-script', '跟进话术', '候选人跟进、下一步与收尾用语。', 'followup-script'),
    card('technical-spec', '技术规范', '技术题目、架构背景与约束条件。', 'technical-spec'),
    card('rubric', '评分标准', '技术评估标准与成功指标。', 'rubric'),
    card('practice-problem', '练习题', '练习题目、示例约束与准备要点。', 'practice-problem'),
  ],
  systemPromptSuffix: (resolution) => {
    if (resolution.subScenario === 'recruiter') {
      return 'You are helping the user in an interview scenario from the recruiter perspective. Use candidate, role, scorecard, and follow-up materials as grounding context.';
    }
    if (resolution.subScenario === 'technical') {
      return 'You are helping the user in a technical interview scenario. Use candidate, technical specification, rubric, and practice problem materials as grounding context.';
    }
    return 'You are helping the user in an interview scenario from the candidate perspective. Use candidate profile, job description, company research, and negotiation materials as grounding context.';
  },
});

export const lectureScenarioAdapter = createAdapter({
  type: 'lecture',
  label: '讲座',
  supportedDocSubtypes: [
    'audience-profile',
    'outline',
    'references',
  ],
  cards: [
    card('audience-profile', '听众画像', '听众水平、目标与学习背景。', 'audience-profile'),
    card('outline', '讲纲', '讲座结构、主题与顺序安排。', 'outline'),
    card('references', '参考资料', '阅读材料、引用与辅助资料。', 'references'),
  ],
  systemPromptSuffix: 'You are helping the user in a lecture scenario. Use audience profile, outline, and reference materials as grounding context.',
});

export const teamMeetScenarioAdapter = createAdapter({
  type: 'team-meet',
  label: '团队会议',
  supportedDocSubtypes: [
    'attendees',
    'agenda',
    'decision-log',
    'references',
  ],
  cards: [
    card('attendees', '与会人员', '参会者、角色、职责与干系人背景。', 'attendees'),
    card('agenda', '会议议程', '会议议程与预期讨论主题。', 'agenda'),
    card('decision-log', '决策记录', '既往决策、依据与待决问题。', 'decision-log'),
    card('references', '参考资料', '支持材料、链接与项目背景。', 'references'),
  ],
  systemPromptSuffix: 'You are helping the user in a team meeting scenario. Use attendee, agenda, decision log, and reference materials as grounding context.',
});

export const generalScenarioAdapter = createAdapter({
  type: 'general',
  label: '通用',
  supportedDocSubtypes: [
    'references',
    'context-note',
  ],
  cards: [
    card('references', '参考资料', '对话通用参考材料。', 'references'),
    card('context-note', '背景备注', '备注、约束与前期讨论背景。', 'context-note'),
  ],
  systemPromptSuffix: 'You are helping the user in a general scenario. Use reference materials and context notes as grounding context.',
});

export const defaultScenarioAdapters: ScenarioAdapter[] = [
  salesScenarioAdapter,
  interviewScenarioAdapter,
  lectureScenarioAdapter,
  teamMeetScenarioAdapter,
  generalScenarioAdapter,
];
