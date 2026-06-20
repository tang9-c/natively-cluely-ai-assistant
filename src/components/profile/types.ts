export type ScenarioDocSubtype =
    | 'customer-profile'
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
}
