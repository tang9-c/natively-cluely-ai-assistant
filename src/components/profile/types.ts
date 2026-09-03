export type ScenarioDocSubtype =
    | 'customer-profile'
    | 'product-intro'
    | 'solution-brief'
    | 'case-study'
    | 'pricing-objections'
    | 'customer-architecture'
    | 'customer-workflow'
    | 'security-requirements'
    | 'prototype-scope'
    | 'delivery-risk'
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

export interface ScenarioCard {
    id: string;
    title: string;
    description: string;
    docSubtype: ScenarioDocSubtype;
    componentKey?: 'reference-materials' | 'scenario-summary' | string;
}

export interface ActiveScenario {
    templateType: string;
    scenarioType: string;
    subScenario?: string;
    adapter: {
        label: string;
        supportedDocSubtypes: ScenarioDocSubtype[];
        cards: ScenarioCard[];
    };
}

export interface ScenarioDocument {
    id: string;
    modeId?: string;
    fileName?: string;
    title?: string;
    path?: string;
    extractedText?: string;
    content?: string;
    scenarioType?: string;
    scenario_type?: string;
    docSubtype?: ScenarioDocSubtype;
    doc_subtype?: ScenarioDocSubtype;
    sourceHash?: string;
    source_hash?: string;
    createdAt?: string;
    created_at?: string;
    updatedAt?: string;
    updated_at?: string;
    parsedJson?: { companyName?: string } | null;
}

export interface MasterProfile {
    displayName?: string;
    headline?: string;
    summary?: string;
    contactInfo?: string;
    experience?: string;
    skills?: string;
    projects?: unknown[];
    education?: unknown[];
}

export interface ProfileVisualizerExperience {
    title?: string;
    organization?: string;
    start?: string;
    end?: string;
    description?: string;
}

export interface ProfileVisualizerData {
    identity?: {
        name?: string;
        email?: string;
    };
    summary?: string;
    experiencePreview?: ProfileVisualizerExperience[];
    experienceCount?: number;
    projectCount?: number;
    nodeCount?: number;
    skills?: string[];
    hasActiveJD?: boolean;
    activeJD?: {
        title?: string;
        company?: string;
        level?: string;
        technologies?: string[];
    };
}

export interface NormalizedProfileVisualizerData {
    isActive: boolean;
    displayName: string;
    email?: string;
    summary?: string;
    experienceCount: number;
    projectCount: number;
    nodeCount: number;
    skills: string[];
    skillCount: number;
    experiences: ProfileVisualizerExperience[];
    hiddenExperienceCount: number;
    hasActiveJD: boolean;
    activeJD?: ProfileVisualizerData['activeJD'];
}
