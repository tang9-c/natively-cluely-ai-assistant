export type BusinessSystemSourceKind = 'plm' | 'qms' | 'business_system';

export type BusinessSystemAuthType = 'api_key' | 'username_password';

export interface BusinessSystemKnowledgeSource {
    id: string;
    name: string;
    kind: BusinessSystemSourceKind;
    url: string;
    authType: BusinessSystemAuthType;
    enabled: boolean;
    isDefault?: boolean;
    createdAt?: string;
    updatedAt?: string;
}

export interface BusinessSystemCredentialInput {
    apiKey?: string;
    username?: string;
    password?: string;
}

export interface BusinessSystemCredentialState {
    hasApiKey: boolean;
    hasUsername: boolean;
    hasPassword: boolean;
}

export interface BusinessSystemKnowledgeSourcePublic extends BusinessSystemKnowledgeSource {
    credentialState: BusinessSystemCredentialState;
}

export type BusinessSystemQueryStatus =
    | 'ok'
    | 'missing_query_anchor'
    | 'no_result'
    | 'ambiguous'
    | 'auth_failed'
    | 'unavailable'
    | 'not_configured'
    | 'unsupported_operation'
    | 'timeout'
    | 'error';

export type BusinessSystemFixedReplyStatus =
    | Exclude<BusinessSystemQueryStatus, 'ok'>;

export interface BusinessSystemEvidenceField {
    name: string;
    value: string;
}

export interface BusinessSystemEvidenceRecord {
    title?: string;
    fields: BusinessSystemEvidenceField[];
}

export interface BusinessSystemEvidence {
    source: string;
    sourceTool?: string;
    recordCount: number;
    records: BusinessSystemEvidenceRecord[];
    omittedFieldCount?: number;
}

export interface BusinessSystemQueryResult {
    status: BusinessSystemQueryStatus;
    sourceName?: string;
    summary?: string;
    evidence?: BusinessSystemEvidence;
    items?: unknown[];
    errorCode?: string;
}

export type BusinessSystemTriggerFailureReason =
    | 'not_explicitly_requested'
    | 'missing_query_anchor';

export interface BusinessSystemTriggerResult {
    shouldQuery: boolean;
    query?: string;
    sourceHint?: BusinessSystemSourceKind;
    recentContext?: string;
    failureReason?: BusinessSystemTriggerFailureReason;
    userMessage?: string;
}
