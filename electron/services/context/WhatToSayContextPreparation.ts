import * as crypto from 'crypto';
import { app } from 'electron';
import { DatabaseManager, type AnswerCitationRecord, type AnswerDegradedReason } from '../../db/DatabaseManager';
import type { ModeEventContext } from '../../llm';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import { validateImagePath as defaultValidateImagePath } from '../../utils/curlUtils';
import { businessSystemDegradedReasonForStatus, BusinessSystemContextService } from '../business-system/BusinessSystemContextService';
import { createWindchillBusinessContextAdapter } from '../business-system/WindchillBusinessContextAdapter';
import { CredentialsManager } from '../CredentialsManager';
import { getContextQualityDiagnosticsCollector } from '../eval/ContextQualityDiagnostics';
import { KnowledgeMaterialService } from '../knowledge/KnowledgeMaterialService';
import {
    buildUploadedMaterialContextContribution,
    type UploadedMaterialContextContribution,
    type UploadedMaterialSearchService,
} from '../knowledge/UploadedMaterialContextContributionService';
import { SettingsManager } from '../SettingsManager';
import { getScreenUnderstandingService } from '../screen/ScreenUnderstandingService';
import {
    buildRealtimeContextPlan,
    formatInjectedContext,
    type RealtimeContextCandidate,
    type RealtimeContextPlan,
} from './RealtimeContextOrchestrator';
import {
    sanitizeContextNeedDecision,
    UNKNOWN_CONTEXT_NEED_DECISION,
    type ContextNeedDecision,
    type ContextNeedLevel,
} from './ContextNeedDecision';

export type WhatToSaySource = 'overlay' | 'launcher' | 'dynamic_action';

export interface WhatToSayModeEventContext extends ModeEventContext {
    actionId?: string;
    productContract?: {
        outputType?: string;
        contextNeedDecision?: ContextNeedDecision;
    };
}

export interface WhatToSayContextPreparationTimings {
    contextNeedDecisionMs: number;
    serviceInitMs: number;
    ragReadinessMs: number;
    screenMs: number;
    businessMs: number;
    materialMs: number;
    contextPlanMs: number;
    totalPrepMs: number;
}

export interface WhatToSayContextPreparationInput {
    question?: string;
    imagePaths?: string[];
    source?: WhatToSaySource;
    modeEvent?: WhatToSayModeEventContext;
    providerScopes?: ProviderDataScopePolicy;
    ragManager?: any;
    materialServiceFactory?: () => UploadedMaterialSearchService;
    businessSystemServiceFactory?: () => Pick<BusinessSystemContextService, 'resolve'>;
    screenUnderstandingServiceFactory?: () => { understand: (input: any) => Promise<any> };
    validateImagePath?: (imagePath: string, userDataDir: string) => { isValid: boolean; reason?: string };
    userDataDir?: string;
    now?: () => number;
}

export interface WhatToSayContextPreparationResult {
    contextNeedDecision: ContextNeedDecision;
    decisionSource: ContextNeedDecision['decidedBy'];
    fastPath: boolean;
    invalidRequest?: {
        error: string;
        statusCode: 'invalid-request';
    };
    validatedImagePaths?: string[];
    screenContext?: any;
    screenContextStatus: 'not_available' | 'available' | 'failed';
    visionProviderUsed?: string;
    visionModelUsed?: string;
    visionAttempts?: number;
    visionFailureReason?: string;
    uploadedMaterialContext?: string;
    citations: AnswerCitationRecord[];
    degradedReasons: AnswerDegradedReason[];
    contextBudgetDegradedReasons: AnswerDegradedReason[];
    materialRagAttempted: boolean;
    uploadedMaterialHitCount: number;
    businessSystemResult: any;
    ragReady: boolean;
    embeddingReady: boolean;
    realtimeContextPlan: RealtimeContextPlan;
    retrievalTimingMs: Partial<Record<string, number>>;
    timings: WhatToSayContextPreparationTimings;
}

const CONTEXT_TOKEN_BUDGET = 1800;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 50;
const EMBEDDING_READY_STATUS_WAIT_MS = 2_500;

let cachedBusinessSystemService: Pick<BusinessSystemContextService, 'resolve'> | null = null;
let cachedMaterialService: UploadedMaterialSearchService | null = null;
const materialContributionCache = new Map<string, { expiresAt: number; value: UploadedMaterialContextContribution }>();
const businessResultCache = new Map<string, { expiresAt: number; value: any }>();
const screenResultCache = new Map<string, { expiresAt: number; value: any }>();

function addUniqueReason(reasons: AnswerDegradedReason[], reason: AnswerDegradedReason): void {
    if (!reasons.includes(reason)) reasons.push(reason);
}

function measure(now: () => number, startedAt: number): number {
    return Math.max(0, now() - startedAt);
}

function compact(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function hashKey(value: string): string {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
}

function pruneCache<T>(cache: Map<string, { expiresAt: number; value: T }>, nowMs: number): void {
    for (const [key, item] of cache) {
        if (item.expiresAt <= nowMs) cache.delete(key);
    }
    while (cache.size > MAX_CACHE_ENTRIES) {
        const firstKey = cache.keys().next().value;
        if (!firstKey) break;
        cache.delete(firstKey);
    }
}

function readCache<T>(cache: Map<string, { expiresAt: number; value: T }>, key: string, nowMs: number): T | undefined {
    const item = cache.get(key);
    if (!item || item.expiresAt <= nowMs) {
        if (item) cache.delete(key);
        return undefined;
    }
    return item.value;
}

function writeCache<T>(cache: Map<string, { expiresAt: number; value: T }>, key: string, value: T, nowMs: number): void {
    pruneCache(cache, nowMs);
    cache.set(key, { expiresAt: nowMs + CACHE_TTL_MS, value });
}

function cloneContribution(value: UploadedMaterialContextContribution): UploadedMaterialContextContribution {
    return {
        ...value,
        contextCandidates: [...value.contextCandidates],
        degradedReasons: [...value.degradedReasons],
        citations: [...value.citations],
        retrievalTimingMs: { ...value.retrievalTimingMs },
        sourceStatus: { ...value.sourceStatus },
    };
}

function getDefaultBusinessSystemService(): Pick<BusinessSystemContextService, 'resolve'> {
    if (!cachedBusinessSystemService) {
        cachedBusinessSystemService = new BusinessSystemContextService({
            credentialsManager: CredentialsManager.getInstance(),
            plmAdapter: createWindchillBusinessContextAdapter(),
        });
    }
    return cachedBusinessSystemService;
}

function getDefaultMaterialService(ragManager: any): UploadedMaterialSearchService {
    if (!cachedMaterialService) {
        cachedMaterialService = new KnowledgeMaterialService(
            DatabaseManager.getInstance(),
            ragManager?.getEmbeddingPipeline?.(),
        );
    }
    return cachedMaterialService;
}

function emptyPlan(
    ragReady: boolean,
    embeddingReady: boolean,
    screenContextStatus: 'not_available' | 'available' | 'failed',
): RealtimeContextPlan {
    return buildRealtimeContextPlan({
        candidates: [],
        tokenBudget: CONTEXT_TOKEN_BUDGET,
        ragReady,
        embeddingReady,
        screenContextStatus,
        retrievalTimingMs: {},
        degradedReasons: [],
    });
}

function buildBusinessSystemRecentContextSummary(value: unknown): string | undefined {
    const text = typeof value === 'string'
        ? value
        : typeof (value as any)?.text === 'string'
            ? (value as any).text
            : '';
    const compacted = text.replace(/\s+/g, ' ').trim();
    if (!compacted) return undefined;
    const sentences: string[] = compacted.match(/[^。！？.!?]+[。！？.!?]?/g) || [compacted];
    const summary = sentences
        .map((sentence: string) => sentence.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join('');
    return summary || undefined;
}

function resolveContextNeedDecision(modeEvent?: WhatToSayModeEventContext): ContextNeedDecision {
    return sanitizeContextNeedDecision(modeEvent?.productContract?.contextNeedDecision)
        || UNKNOWN_CONTEXT_NEED_DECISION;
}

export function getRagReadinessSnapshot(ragManager: any): { ragReady: boolean; embeddingReady: boolean } {
    return {
        ragReady: Boolean(ragManager?.isReady?.()),
        embeddingReady: Boolean(ragManager?.getEmbeddingPipeline?.().isReady?.()),
    };
}

async function getRagReadinessForDecision(
    ragManager: any,
    decision: ContextNeedDecision,
): Promise<{ ragReady: boolean; embeddingReady: boolean }> {
    if (shouldRunSlowContext(decision.material)) {
        const embeddingPipeline = ragManager?.getEmbeddingPipeline?.();
        if (
            embeddingPipeline &&
            !embeddingPipeline.isReady?.() &&
            typeof embeddingPipeline.waitForReady === 'function'
        ) {
            try {
                await embeddingPipeline.waitForReady(EMBEDDING_READY_STATUS_WAIT_MS);
            } catch {
                // Snapshot below records unavailable if initialization did not finish.
            }
        }
    }
    return getRagReadinessSnapshot(ragManager);
}

function shouldRunSlowContext(level: ContextNeedLevel): boolean {
    return level === 'required' || level === 'unknown';
}

function shouldUseReadyContext(level: ContextNeedLevel): boolean {
    return level === 'use_if_ready';
}

function getMaterialCacheKey(input: {
    query: string;
    providerScopes?: ProviderDataScopePolicy;
    ragReady: boolean;
    embeddingReady: boolean;
}): string {
    return hashKey(JSON.stringify({
        query: compact(input.query).toLowerCase(),
        referenceFiles: input.providerScopes?.reference_files !== false,
        ragReady: input.ragReady,
        embeddingReady: input.embeddingReady,
        tokenBudget: CONTEXT_TOKEN_BUDGET,
    }));
}

function getBusinessCacheKey(question?: string, recentContext?: string): string {
    return hashKey(`${compact(question).toLowerCase()}\n${compact(recentContext).toLowerCase()}`);
}

function getScreenCacheKey(paths: string[]): string {
    return hashKey(paths.join('\n'));
}

function validateImagePaths(input: WhatToSayContextPreparationInput): string[] | { error: string } | undefined {
    if (!input.imagePaths || input.imagePaths.length === 0) return undefined;
    if (
        !Array.isArray(input.imagePaths) ||
        input.imagePaths.length > 5 ||
        input.imagePaths.some((imagePath) => typeof imagePath !== 'string' || imagePath.trim().length === 0)
    ) {
        return { error: 'Invalid image path payload' };
    }

    const validator = input.validateImagePath || defaultValidateImagePath;
    const userDataDir = input.userDataDir || app.getPath('userData');
    const validated: string[] = [];
    for (const imagePath of input.imagePaths) {
        const validation = validator(imagePath, userDataDir);
        if (!validation.isValid) {
            return { error: `Invalid image path: ${validation.reason}` };
        }
        validated.push(imagePath);
    }
    return validated;
}

async function prepareScreenContext(input: {
    request: WhatToSayContextPreparationInput;
    decision: ContextNeedDecision;
    validatedImagePaths?: string[];
    providerScopes?: ProviderDataScopePolicy;
    degradedReasons: AnswerDegradedReason[];
    timings: WhatToSayContextPreparationTimings;
    now: () => number;
}): Promise<Pick<WhatToSayContextPreparationResult,
    'screenContext' |
    'screenContextStatus' |
    'visionProviderUsed' |
    'visionModelUsed' |
    'visionAttempts' |
    'visionFailureReason'
>> {
    const paths = input.validatedImagePaths;
    if (!paths?.length || input.decision.screen === 'not_needed') {
        return { screenContextStatus: 'not_available' };
    }

    const cacheKey = getScreenCacheKey(paths);
    const cached = readCache(screenResultCache, cacheKey, input.now());
    if (cached) {
        return {
            screenContext: cached.status === 'available' ? cached : undefined,
            screenContextStatus: cached.status === 'available'
                ? 'available'
                : cached.status === 'failed'
                    ? 'failed'
                    : 'not_available',
            visionProviderUsed: cached.providerUsed,
            visionModelUsed: cached.modelUsed,
            visionAttempts: Array.isArray(cached.attempts) ? cached.attempts.length : undefined,
            visionFailureReason: cached.failureReason,
        };
    }

    if (shouldUseReadyContext(input.decision.screen)) {
        addUniqueReason(input.degradedReasons, 'screen_context_dropped');
        return { screenContextStatus: 'not_available' };
    }

    const startedAt = input.now();
    try {
        const sus = input.request.screenUnderstandingServiceFactory?.() || getScreenUnderstandingService();
        const settings = SettingsManager.getInstance();
        const credentials = CredentialsManager.getInstance();
        const localVisionAvailable = credentials.anyLocalVisionProviderConfigured?.() ?? false;
        if (input.providerScopes?.screenshots === false) {
            addUniqueReason(input.degradedReasons, localVisionAvailable ? 'screen_context_scope_blocked' : 'screen_context_no_vision_provider');
        }
        const sur = await sus.understand({
            modeId: 'what-to-say',
            transcript: input.request.question,
            userAction: 'what_to_say',
            qualityMode: 'balanced',
            imagePaths: paths,
            screenUnderstandingMode: settings.getScreenUnderstandingMode(),
            technicalInterviewVisionFirst: settings.getTechnicalInterviewVisionFirst(),
            providerPolicy: {
                localOnly: settings.getScreenUnderstandingMode() === 'private_vision',
                allowScreenshots: input.providerScopes?.screenshots !== false,
                visionAvailable: credentials.anyVisionProviderConfigured?.() ?? true,
                localVisionAvailable,
            },
        });
        input.timings.screenMs = measure(input.now, startedAt);
        writeCache(screenResultCache, cacheKey, sur, input.now());
        return {
            screenContext: sur.status === 'available' ? sur : undefined,
            screenContextStatus: sur.status === 'available'
                ? 'available'
                : sur.status === 'failed'
                    ? 'failed'
                    : 'not_available',
            visionProviderUsed: sur.providerUsed,
            visionModelUsed: sur.modelUsed,
            visionAttempts: Array.isArray(sur.attempts) ? sur.attempts.length : undefined,
            visionFailureReason: sur.failureReason,
        };
    } catch {
        input.timings.screenMs = measure(input.now, startedAt);
        addUniqueReason(input.degradedReasons, 'screen_context_failed');
        return { screenContextStatus: 'failed' };
    }
}

async function prepareBusinessContext(input: {
    request: WhatToSayContextPreparationInput;
    decision: ContextNeedDecision;
    contextCandidates: RealtimeContextCandidate[];
    retrievalTimingMs: Partial<Record<string, number>>;
    degradedReasons: AnswerDegradedReason[];
    timings: WhatToSayContextPreparationTimings;
    now: () => number;
}): Promise<any> {
    if (input.decision.business === 'not_needed') return { kind: 'skipped' };
    const recentContext = buildBusinessSystemRecentContextSummary(input.request.modeEvent?.latestTurn);
    const cacheKey = getBusinessCacheKey(input.request.question, recentContext);
    const cached = readCache(businessResultCache, cacheKey, input.now());
    if (cached) {
        if (cached.kind === 'context') input.contextCandidates.push(cached.candidate);
        return cached;
    }
    if (shouldUseReadyContext(input.decision.business)) {
        addUniqueReason(input.degradedReasons, 'business_system_context_dropped');
        return { kind: 'skipped' };
    }

    const startedAt = input.now();
    try {
        const serviceInitStartedAt = input.now();
        const service = input.request.businessSystemServiceFactory?.() || getDefaultBusinessSystemService();
        input.timings.serviceInitMs += measure(input.now, serviceInitStartedAt);
        const result = await service.resolve({
            question: input.request.question,
            recentContext,
        });
        input.timings.businessMs = measure(input.now, startedAt);
        input.retrievalTimingMs.business_system = input.timings.businessMs;
        if (result.kind === 'context') input.contextCandidates.push(result.candidate);
        if (result.kind !== 'skipped') writeCache(businessResultCache, cacheKey, result, input.now());
        if (result.kind === 'fixed_reply') {
            addUniqueReason(input.degradedReasons, businessSystemDegradedReasonForStatus(result.status));
        }
        return result;
    } catch {
        input.timings.businessMs = measure(input.now, startedAt);
        input.retrievalTimingMs.business_system = input.timings.businessMs;
        addUniqueReason(input.degradedReasons, 'business_system_unavailable');
        return { kind: 'fixed_reply', status: 'unavailable' };
    }
}

async function prepareMaterialContext(input: {
    request: WhatToSayContextPreparationInput;
    decision: ContextNeedDecision;
    ragReady: boolean;
    embeddingReady: boolean;
    contextCandidates: RealtimeContextCandidate[];
    citations: AnswerCitationRecord[];
    retrievalTimingMs: Partial<Record<string, number>>;
    degradedReasons: AnswerDegradedReason[];
    timings: WhatToSayContextPreparationTimings;
    now: () => number;
}): Promise<{ materialRagAttempted: boolean; uploadedMaterialHitCount: number }> {
    if (input.decision.material === 'not_needed') {
        return { materialRagAttempted: false, uploadedMaterialHitCount: 0 };
    }

    const modeQuery = compact(input.request.modeEvent?.retrievalQuery);
    const questionQuery = compact(input.request.question);
    const searchQuery = modeQuery || questionQuery;
    if (!searchQuery) {
        if (input.decision.material === 'required') addUniqueReason(input.degradedReasons, 'uploaded_material_context_dropped');
        return { materialRagAttempted: false, uploadedMaterialHitCount: 0 };
    }

    const cacheKey = getMaterialCacheKey({
        query: searchQuery,
        providerScopes: input.request.providerScopes,
        ragReady: input.ragReady,
        embeddingReady: input.embeddingReady,
    });
    const cached = readCache(materialContributionCache, cacheKey, input.now());
    if (cached) {
        const contribution = cloneContribution(cached);
        input.contextCandidates.push(...contribution.contextCandidates);
        input.citations.push(...contribution.citations);
        Object.assign(input.retrievalTimingMs, contribution.retrievalTimingMs);
        for (const reason of contribution.degradedReasons) addUniqueReason(input.degradedReasons, reason);
        return {
            materialRagAttempted: contribution.sourceStatus.ragAttempted,
            uploadedMaterialHitCount: contribution.uploadedMaterialHitCount,
        };
    }
    if (shouldUseReadyContext(input.decision.material)) {
        addUniqueReason(input.degradedReasons, 'uploaded_material_context_dropped');
        return { materialRagAttempted: false, uploadedMaterialHitCount: 0 };
    }

    const startedAt = input.now();
    const serviceInitStartedAt = input.now();
    const materialService = input.request.materialServiceFactory?.() || getDefaultMaterialService(input.request.ragManager);
    input.timings.serviceInitMs += measure(input.now, serviceInitStartedAt);
    const contribution = await buildUploadedMaterialContextContribution({
        query: searchQuery,
        scopePolicy: input.request.providerScopes,
        materialService,
        ragReady: input.ragReady,
        embeddingReady: input.embeddingReady,
        tokenBudget: CONTEXT_TOKEN_BUDGET,
        surface: input.request.source,
        deferContextPlan: true,
    });
    input.timings.materialMs = measure(input.now, startedAt);
    input.contextCandidates.push(...contribution.contextCandidates);
    input.citations.push(...contribution.citations);
    Object.assign(input.retrievalTimingMs, contribution.retrievalTimingMs);
    for (const reason of contribution.degradedReasons) addUniqueReason(input.degradedReasons, reason);
    writeCache(materialContributionCache, cacheKey, cloneContribution(contribution), input.now());
    return {
        materialRagAttempted: contribution.sourceStatus.ragAttempted,
        uploadedMaterialHitCount: contribution.uploadedMaterialHitCount,
    };
}

export async function prepareWhatToSayContext(
    input: WhatToSayContextPreparationInput,
): Promise<WhatToSayContextPreparationResult> {
    const now = input.now || (() => Date.now());
    const startedAt = now();
    const timings: WhatToSayContextPreparationTimings = {
        contextNeedDecisionMs: 0,
        serviceInitMs: 0,
        ragReadinessMs: 0,
        screenMs: 0,
        businessMs: 0,
        materialMs: 0,
        contextPlanMs: 0,
        totalPrepMs: 0,
    };
    const contextDecisionStartedAt = now();
    const contextNeedDecision = resolveContextNeedDecision(input.modeEvent);
    timings.contextNeedDecisionMs = measure(now, contextDecisionStartedAt);
    const degradedReasons: AnswerDegradedReason[] = [];
    const contextBudgetDegradedReasons: AnswerDegradedReason[] = [];
    const citations: AnswerCitationRecord[] = [];
    const contextCandidates: RealtimeContextCandidate[] = [];
    const retrievalTimingMs: Partial<Record<string, number>> = {};

    const validatedImagePathsResult = validateImagePaths(input);
    if (validatedImagePathsResult && !Array.isArray(validatedImagePathsResult)) {
        const ragSnapshot = getRagReadinessSnapshot(input.ragManager);
        const realtimeContextPlan = emptyPlan(true, true, 'not_available');
        return {
            contextNeedDecision,
            decisionSource: contextNeedDecision.decidedBy,
            fastPath: true,
            invalidRequest: {
                error: validatedImagePathsResult.error,
                statusCode: 'invalid-request',
            },
            screenContextStatus: 'not_available',
            citations,
            degradedReasons,
            contextBudgetDegradedReasons,
            materialRagAttempted: false,
            uploadedMaterialHitCount: 0,
            businessSystemResult: { kind: 'skipped' },
            ragReady: ragSnapshot.ragReady,
            embeddingReady: ragSnapshot.embeddingReady,
            realtimeContextPlan,
            retrievalTimingMs,
            timings: { ...timings, totalPrepMs: measure(now, startedAt) },
        };
    }
    const validatedImagePaths = Array.isArray(validatedImagePathsResult)
        ? validatedImagePathsResult
        : undefined;

    const ragReadinessStartedAt = now();
    const { ragReady, embeddingReady } = await getRagReadinessForDecision(input.ragManager, contextNeedDecision);
    timings.ragReadinessMs = measure(now, ragReadinessStartedAt);

    const screenPromise = prepareScreenContext({
        request: input,
        decision: contextNeedDecision,
        validatedImagePaths,
        providerScopes: input.providerScopes,
        degradedReasons,
        timings,
        now,
    });
    const businessPromise = prepareBusinessContext({
        request: input,
        decision: contextNeedDecision,
        contextCandidates,
        retrievalTimingMs,
        degradedReasons,
        timings,
        now,
    });
    const materialPromise = prepareMaterialContext({
        request: input,
        decision: contextNeedDecision,
        ragReady,
        embeddingReady,
        contextCandidates,
        citations,
        retrievalTimingMs,
        degradedReasons,
        timings,
        now,
    });

    const [screenResult, businessSystemResult, materialResult] = await Promise.all([
        screenPromise,
        businessPromise,
        materialPromise,
    ]);
    if (!ragReady && materialResult.materialRagAttempted) addUniqueReason(degradedReasons, 'rag_unavailable');
    if (!embeddingReady && materialResult.materialRagAttempted) addUniqueReason(degradedReasons, 'embedding_unavailable');

    const contextPlanStartedAt = now();
    const realtimeContextPlan = buildRealtimeContextPlan({
        candidates: contextCandidates,
        tokenBudget: CONTEXT_TOKEN_BUDGET,
        ragAttempted: materialResult.materialRagAttempted,
        ragReady: materialResult.materialRagAttempted ? ragReady : true,
        embeddingReady: materialResult.materialRagAttempted ? embeddingReady : true,
        uploadedMaterialHitCount: materialResult.uploadedMaterialHitCount,
        screenContextStatus: screenResult.screenContextStatus,
        retrievalTimingMs: retrievalTimingMs as any,
        degradedReasons: degradedReasons as any,
    });
    timings.contextPlanMs = measure(now, contextPlanStartedAt);
    for (const reason of realtimeContextPlan.degradedReasons) addUniqueReason(contextBudgetDegradedReasons, reason);
    getContextQualityDiagnosticsCollector().recordContextPlan({
        injectedSources: realtimeContextPlan.injected.map((item) => item.source),
        omittedSources: realtimeContextPlan.omitted.map((item) => ({ source: item.source, reason: item.reason })),
        degradedReasons: realtimeContextPlan.degradedReasons,
        retrievalTimingMs: realtimeContextPlan.retrievalTimingMs,
    });

    const uploadedMaterialContext = formatInjectedContext(realtimeContextPlan) || undefined;
    const fastEligibleDecision = [
        contextNeedDecision.material,
        contextNeedDecision.business,
        contextNeedDecision.screen,
    ].every((level) => level === 'not_needed' || level === 'use_if_ready');
    timings.totalPrepMs = measure(now, startedAt);

    return {
        contextNeedDecision,
        decisionSource: contextNeedDecision.decidedBy,
        fastPath: fastEligibleDecision,
        validatedImagePaths,
        ...screenResult,
        uploadedMaterialContext,
        citations,
        degradedReasons,
        contextBudgetDegradedReasons,
        materialRagAttempted: materialResult.materialRagAttempted,
        uploadedMaterialHitCount: materialResult.uploadedMaterialHitCount,
        businessSystemResult,
        ragReady,
        embeddingReady,
        realtimeContextPlan,
        retrievalTimingMs,
        timings,
    };
}
