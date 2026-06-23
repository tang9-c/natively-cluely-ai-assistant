import type { ProviderDataScope } from '../../../llm/ProviderRouter';
import type { ModeTemplateType } from '../../ModesManager';

export type ScenarioType =
  | 'general'
  | 'sales'
  | 'fde'
  | 'interview'
  | 'lecture'
  | 'team-meet';

export type InterviewSubScenario =
  | 'candidate'
  | 'recruiter'
  | 'technical';

export type ScenarioDocSubtype =
  | 'customer-profile'
  | 'customer-architecture'
  | 'customer-workflow'
  | 'security-requirements'
  | 'prototype-scope'
  | 'delivery-risk'
  | 'product-intro'
  | 'solution-brief'
  | 'case-study'
  | 'pricing-objections'
  | 'candidate-profile'
  | 'candidate-resume'
  | 'job-description'
  | 'company-research'
  | 'negotiation-script'
  | 'scorecard'
  | 'followup-script'
  | 'technical-spec'
  | 'rubric'
  | 'practice-problem'
  | 'audience-profile'
  | 'outline'
  | 'references'
  | 'attendees'
  | 'agenda'
  | 'decision-log'
  | 'context-note';

export interface ScenarioResolution {
  templateType: ModeTemplateType;
  scenarioType: ScenarioType;
  subScenario?: InterviewSubScenario;
}

export interface ScenarioCardDefinition {
  id: string;
  title: string;
  description: string;
  docSubtype: ScenarioDocSubtype;
  componentKey: 'reference-materials' | 'scenario-summary';
}

export interface ScenarioDocument {
  subtype: ScenarioDocSubtype;
  title?: string;
  content: string;
  source?: string;
}

export interface ScenarioContextBuildResult {
  systemPromptSuffix: string;
  contextBlock: string;
  dataScopes: ProviderDataScope[];
}

export interface ScenarioAdapter {
  type: ScenarioType;
  label: string;
  supportedDocSubtypes: ScenarioDocSubtype[];
  cards: ScenarioCardDefinition[];
  dataScopes: ProviderDataScope[];
  getSystemPromptSuffix(resolution: ScenarioResolution): string;
  formatDocumentContext(document: ScenarioDocument): string;
}
