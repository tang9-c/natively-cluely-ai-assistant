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
  label: 'Sales',
  supportedDocSubtypes: [
    'customer-profile',
    'product-intro',
    'solution-brief',
    'case-study',
    'pricing-objections',
  ],
  cards: [
    card('customer-profile', 'Customer profile', 'Prospect background, stakeholders, pains, and buying context.', 'customer-profile'),
    card('product-intro', 'Product intro', 'Positioning, product capabilities, and demo notes.', 'product-intro'),
    card('solution-brief', 'Solution brief', 'Recommended solution shape and value proof.', 'solution-brief'),
    card('case-study', 'Case study', 'Relevant customer evidence and outcomes.', 'case-study'),
    card('pricing-objections', 'Pricing objections', 'Pricing, procurement, and objection handling notes.', 'pricing-objections'),
  ],
  systemPromptSuffix: 'You are helping the user in a sales scenario. Use customer, product, solution, case study, pricing, and objection materials as grounding context.',
});

export const interviewScenarioAdapter = createAdapter({
  type: 'interview',
  label: 'Interview',
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
    card('candidate-profile', 'Candidate profile', 'Candidate background, goals, strengths, and positioning notes.', 'candidate-profile'),
    card('candidate-resume', 'Candidate resume', 'Candidate resume, work history, and experience evidence.', 'candidate-resume'),
    card('job-description', 'Job description', 'Role requirements, responsibilities, and evaluation criteria.', 'job-description'),
    card('company-research', 'Company research', 'Company, team, product, and market context.', 'company-research'),
    card('negotiation-script', 'Negotiation script', 'Compensation, offer, and negotiation talking points.', 'negotiation-script'),
    card('scorecard', 'Scorecard', 'Evaluation criteria, competencies, and rating guidance.', 'scorecard'),
    card('followup-script', 'Follow-up script', 'Candidate follow-up, next steps, and closing language.', 'followup-script'),
    card('technical-spec', 'Technical spec', 'Technical prompt, architecture context, and constraints.', 'technical-spec'),
    card('rubric', 'Rubric', 'Technical evaluation rubric and success criteria.', 'rubric'),
    card('practice-problem', 'Practice problem', 'Practice question, sample constraints, and preparation notes.', 'practice-problem'),
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
  label: 'Lecture',
  supportedDocSubtypes: [
    'audience-profile',
    'outline',
    'references',
  ],
  cards: [
    card('audience-profile', 'Audience profile', 'Audience level, goals, and learning context.', 'audience-profile'),
    card('outline', 'Outline', 'Lecture structure, topics, and sequencing.', 'outline'),
    card('references', 'References', 'Readings, citations, and supporting material.', 'references'),
  ],
  systemPromptSuffix: 'You are helping the user in a lecture scenario. Use audience profile, outline, and reference materials as grounding context.',
});

export const teamMeetScenarioAdapter = createAdapter({
  type: 'team-meet',
  label: 'Team meet',
  supportedDocSubtypes: [
    'attendees',
    'agenda',
    'decision-log',
    'references',
  ],
  cards: [
    card('attendees', 'Attendees', 'Participants, roles, responsibilities, and stakeholder context.', 'attendees'),
    card('agenda', 'Agenda', 'Meeting agenda and expected discussion topics.', 'agenda'),
    card('decision-log', 'Decision log', 'Prior decisions, rationale, and open questions.', 'decision-log'),
    card('references', 'References', 'Supporting materials, links, and project context.', 'references'),
  ],
  systemPromptSuffix: 'You are helping the user in a team meeting scenario. Use attendee, agenda, decision log, and reference materials as grounding context.',
});

export const generalScenarioAdapter = createAdapter({
  type: 'general',
  label: 'General',
  supportedDocSubtypes: [
    'references',
    'context-note',
  ],
  cards: [
    card('references', 'References', 'General reference material for the conversation.', 'references'),
    card('context-note', 'Context note', 'Notes, constraints, and prior discussion context.', 'context-note'),
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
