import * as crypto from 'crypto';
import { app } from 'electron';
import { DatabaseManager, type AnswerCitationRecord, type AnswerDegradedReason } from '../../db/DatabaseManager';
import type { ModeEventContext } from '../../llm';
import type { ProviderDataScopePolicy } from '../../llm/ProviderRouter';
import type { EmbeddingPipeline } from '../../rag/EmbeddingPipeline';
import { validateImagePath as defaultValidateImagePath } from '../../utils/curlUtils';
import { redactForLog } from '../../utils/redactForLog';
import type { ScreenContext } from '../screen/types';
import {
    businessSystemDegradedReasonForStatus,
    BusinessSystemContextService,
    toBusinessSystemFixedReply,
    type BusinessSystemServiceResult,
} from '../business-system/BusinessSystemContextService';
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
    type RealtimeContextSource,
} from './RealtimeContextOrchestrator';
import {
    sanitizeContextNeedDecision,
    UNKNOWN_CONTEXT_NEED_DECISION,
    type ContextNeedDecision,
    type ContextNeedLevel,
} from './ContextNeedDecision';
import type { ScreenUnderstandingRequest, ScreenUnderstandingResult } from '../screen/ScreenUnderstandingService';

export type WhatToSaySource = 'overlay' | 'launcher' | 'dynamic_action';

interface RagManagerLike {
    isReady?: () => boolean;
    getEmbeddingPipeline?: () => EmbeddingPipeline | null | undefined;
}

type ScreenUnderstandingServiceLike = {
    understand(input: ScreenUnderstandingRequest): Promise<ScreenUnderstandingResult>;
};

type BusinessSystemServiceLike = Pick<BusinessSystemContextService, 'resolve'>;

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
    ragManager?: unknown;
    materialServiceFactory?: () => UploadedMaterialSearchService;
    businessSystemServiceFactory?: () => BusinessSystemServiceLike;
    screenUnderstandingServiceFactory?: () => ScreenUnderstandingServiceLike;
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
    screenContext?: ScreenContext;
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
    businessSystemResult: BusinessSystemServiceResult;
    ragReady: boolean;
    embeddingReady: boolean;
    realtimeContextPlan: RealtimeContextPlan;
    retrievalTimingMs: Partial<Record<RealtimeContextSource, number>>;
    timings: WhatToSayContextPreparationTimings;
}

const CONTEXT_TOKEN_BUDGET = 1800;
const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 50;
const MAX_CONTEXT_IMAGE_PATHS = 5;
const EMBEDDING_READY_STATUS_WAIT_MS = 2_500;

function addUniqueReason(reasons: AnswerDegradedReason[], reason: AnswerDegradedReason): void {
    if (!reasons.includes(reason)) reasons.push(reason);
}

function warnContextPreparationFailure(
    stage: 'embedding_readiness' | 'screen_context' | 'business_context',
    error: unknown,
    metadata: Record<string, unknown> = {},
): void {
    console.warn('[WhatToSayContextPreparation] context preparation degraded', redactForLog([{
        stage,
        ...metadata,
        failure: error,
    }]));
}

function warnInvalidImagePathPayload(reason: string, metadata: Record<string, unknown> = {}): void {
    console.warn('[WhatToSayContextPreparation] invalid image path payload rejected', redactForLog([{
        reason,
        ...metadata,
    }]));
}

function measure(now: () => number, startedAt: number): number {
    return Math.max(0, now() - startedAt);
}

function compact(value: unknown): string {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function asRagManagerLike(value: unknown): RagManagerLike | undefined {
    if (!isRecord(value)) return undefined;
    return value as RagManagerLike;
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

export class WhatToSayContextPreparationService {
    private static instance: WhatToSayContextPreparationService | null = null;

    private cachedBusinessSystemService: BusinessSystemServiceLike | null = null;
    private cachedMaterialService: UploadedMaterialSearchService | null = null;
    private materialContributionCache = new Map<string, { expiresAt: number; value: UploadedMaterialContextContribution }>();
    private businessResultCache = new Map<string, { expiresAt: number; value: BusinessSystemServiceResult }>();
    private screenResultCache = new Map<string, { expiresAt: number; value: ScreenUnderstandingResult }>();

    private constructor() {}

    static getInstance(): WhatToSayContextPreparationService {
        if (!WhatToSayContextPreparationService.instance) {
            WhatToSayContextPreparationService.instance = new WhatToSayContextPreparationService();
        }
        return WhatToSayContextPreparationService.instance;
    }

    _resetCachesForTest(): void {
        this.cachedBusinessSystemService = null;
        this.cachedMaterialService = null;
        this.materialContributionCache.clear();
        this.businessResultCache.clear();
        this.screenResultCache.clear();
    }

    getDefaultBusinessSystemService(): BusinessSystemServiceLike {
        if (!this.cachedBusinessSystemService) {
            this.cachedBusinessSystemService = new BusinessSystemContextService({
                credentialsManager: CredentialsManager.getInstance(),
                plmAdapter: createWindchillBusinessContextAdapter(),
            });
        }
        return this.cachedBusinessSystemService;
    }

    getDefaultMaterialService(ragManager: unknown): UploadedMaterialSearchService {
        if (!this.cachedMaterialService) {
            const embeddingPipeline = asRagManagerLike(ragManager)?.getEmbeddingPipeline?.();
            this.cachedMaterialService = new KnowledgeMaterialService(
                DatabaseManager.getInstance(),
                embeddingPipeline,
            );
        }
        return this.cachedMaterialService;
    }

    readMaterialContribution(cacheKey: string, nowMs: number): UploadedMaterialContextContribution | undefined {
        const cached = readCache(this.materialContributionCache, cacheKey, nowMs);
        return cached ? cloneContribution(cached) : undefined;
    }

    writeMaterialContribution(cacheKey: string, contribution: UploadedMaterialContextContribution, nowMs: number): void {
        writeCache(this.materialContributionCache, cacheKey, cloneContribution(contribution), nowMs);
    }

    readBusinessResult(cacheKey: string, nowMs: number): BusinessSystemServiceResult | undefined {
        return readCache(this.businessResultCache, cacheKey, nowMs);
    }

    writeBusinessResult(cacheKey: string, result: BusinessSystemServiceResult, nowMs: number): void {
        writeCache(this.businessResultCache, cacheKey, result, nowMs);
    }

    readScreenResult(cacheKey: string, nowMs: number): ScreenUnderstandingResult | undefined {
        return readCache(this.screenResultCache, cacheKey, nowMs);
    }

    writeScreenResult(cacheKey: string, result: ScreenUnderstandingResult, nowMs: number): void {
        writeCache(this.screenResultCache, cacheKey, result, nowMs);
    }

    async prepare(input: WhatToSayContextPreparationInput): Promise<WhatToSayContextPreparationResult> {
        return prepareWhatToSayContextWithService(this, input);
    }
}

function getDefaultBusinessSystemService(service: WhatToSayContextPreparationService): BusinessSystemServiceLike {
    return service.getDefaultBusinessSystemService();
}

function getDefaultMaterialService(service: WhatToSayContextPreparationService, ragManager: unknown): UploadedMaterialSearchService {
    return service.getDefaultMaterialService(ragManager);
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
        : isRecord(value) && typeof value.text === 'string'
            ? value.text
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

function toScreenContext(result: ScreenUnderstandingResult): ScreenContext {
    return {
        ocrText: result.ocrText,
        imagePath: result.imagePath,
        timestamp: result.timestamp ?? result.capturedAt,
        hash: result.hash ?? result.imageHash,
        extractedText: result.extractedText,
        visibleSummary: result.visibleSummary,
        screenType: result.screenType,
        codeBlocks: result.codeBlocks,
        tables: result.tables,
        errors: result.errors,
        taskDetected: result.taskDetected,
        confidence: result.confidence,
        source: result.source,
        providerUsed: result.providerUsed,
        modelUsed: result.modelUsed,
    };
}

function resolveContextNeedDecision(modeEvent?: WhatToSayModeEventContext): ContextNeedDecision {
    return sanitizeContextNeedDecision(modeEvent?.productContract?.contextNeedDecision)
        || UNKNOWN_CONTEXT_NEED_DECISION;
}

export function getRagReadinessSnapshot(ragManager: unknown): { ragReady: boolean; embeddingReady: boolean } {
    const manager = asRagManagerLike(ragManager);
    const embeddingPipeline = manager?.getEmbeddingPipeline?.();
    return {
        ragReady: Boolean(manager?.isReady?.()),
        embeddingReady: Boolean(embeddingPipeline?.isReady?.()),
    };
}

async function getRagReadinessForDecision(
    ragManager: unknown,
    decision: ContextNeedDecision,
): Promise<{ ragReady: boolean; embeddingReady: boolean }> {
    const manager = asRagManagerLike(ragManager);
    if (shouldRunSlowContext(decision.material)) {
        const embeddingPipeline = manager?.getEmbeddingPipeline?.();
        if (
            embeddingPipeline &&
            !embeddingPipeline.isReady?.() &&
            typeof embeddingPipeline.waitForReady === 'function'
        ) {
            try {
                await embeddingPipeline.waitForReady(EMBEDDING_READY_STATUS_WAIT_MS);
            } catch (error) {
                warnContextPreparationFailure('embedding_readiness', error, {
                    decisionMaterial: decision.material,
                    waitMs: EMBEDDING_READY_STATUS_WAIT_MS,
                });
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
    source?: WhatToSaySource;
    modeEvent?: WhatToSayModeEventContext;
    decision: ContextNeedDecision;
    ragReady: boolean;
    embeddingReady: boolean;
}): string {
    return hashKey(JSON.stringify({
        query: compact(input.query).toLowerCase(),
        source: input.source || 'unknown',
        actionId: compact(input.modeEvent?.actionId) || undefined,
        decisionBy: input.decision.decidedBy,
        decisionMaterial: input.decision.material,
        decisionBusiness: input.decision.business,
        decisionScreen: input.decision.screen,
        referenceFiles: input.providerScopes?.reference_files !== false,
        ragReady: input.ragReady,
        embeddingReady: input.embeddingReady,
        tokenBudget: CONTEXT_TOKEN_BUDGET,
    }));
}

function getBusinessCacheKey(question?: string, recentContext?: string): string {
    return hashKey(`${compact(question).toLowerCase()}\n${compact(recentContext).toLowerCase()}`);
}

export function resolveBusinessQueryText(input: {
    question?: string;
    source?: WhatToSaySource;
    modeEvent?: WhatToSayModeEventContext;
}): string | undefined {
    if (input.source === 'dynamic_action' && input.modeEvent?.actionType === 'business_system_query') {
        return compact(input.modeEvent.latestTurn) || compact(input.question) || undefined;
    }
    return compact(input.question) || undefined;
}

function getScreenCacheKey(paths: string[]): string {
    return hashKey(paths.join('\n'));
}

function validateImagePaths(input: WhatToSayContextPreparationInput): string[] | { error: string } | undefined {
    if (!input.imagePaths || input.imagePaths.length === 0) return undefined;
    if (
        !Array.isArray(input.imagePaths) ||
        input.imagePaths.length > MAX_CONTEXT_IMAGE_PATHS ||
        input.imagePaths.some((imagePath) => typeof imagePath !== 'string' || imagePath.trim().length === 0)
    ) {
        warnInvalidImagePathPayload('malformed_payload', {
            imageCount: Array.isArray(input.imagePaths) ? input.imagePaths.length : undefined,
            maxImageCount: MAX_CONTEXT_IMAGE_PATHS,
        });
        return { error: 'Invalid image path payload' };
    }

    const validator = input.validateImagePath || defaultValidateImagePath;
    const userDataDir = input.userDataDir || app.getPath('userData');
    const validated: string[] = [];
    for (const imagePath of input.imagePaths) {
        const validation = validator(imagePath, userDataDir);
        if (!validation.isValid) {
            warnInvalidImagePathPayload('path_validation_failed', {
                validationReason: validation.reason,
                maxImageCount: MAX_CONTEXT_IMAGE_PATHS,
            });
            return { error: `Invalid image path: ${validation.reason}` };
        }
        validated.push(imagePath);
    }
    return validated;
}

async function prepareScreenContext(input: {
    service: WhatToSayContextPreparationService;
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
    const cached = input.service.readScreenResult(cacheKey, input.now());
    if (cached) {
        return {
            screenContext: cached.status === 'available' ? toScreenContext(cached) : undefined,
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
        input.service.writeScreenResult(cacheKey, sur, input.now());
        return {
            screenContext: sur.status === 'available' ? toScreenContext(sur) : undefined,
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
    } catch (error) {
        input.timings.screenMs = measure(input.now, startedAt);
        warnContextPreparationFailure('screen_context', error, {
            source: input.request.source,
            decisionScreen: input.decision.screen,
            elapsedMs: input.timings.screenMs,
            imageCount: paths.length,
        });
        addUniqueReason(input.degradedReasons, 'screen_context_failed');
        return { screenContextStatus: 'failed' };
    }
}

async function prepareBusinessContext(input: {
    service: WhatToSayContextPreparationService;
    request: WhatToSayContextPreparationInput;
    decision: ContextNeedDecision;
    contextCandidates: RealtimeContextCandidate[];
    retrievalTimingMs: Partial<Record<RealtimeContextSource, number>>;
    degradedReasons: AnswerDegradedReason[];
    timings: WhatToSayContextPreparationTimings;
    now: () => number;
}): Promise<BusinessSystemServiceResult> {
    if (input.decision.business === 'not_needed') return { kind: 'skipped' };
    const recentContext = buildBusinessSystemRecentContextSummary(input.request.modeEvent?.latestTurn);
    const businessQuery = resolveBusinessQueryText(input.request);
    const cacheKey = getBusinessCacheKey(businessQuery, recentContext);
    const cached = input.service.readBusinessResult(cacheKey, input.now());
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
        const service = input.request.businessSystemServiceFactory?.() || getDefaultBusinessSystemService(input.service);
        input.timings.serviceInitMs += measure(input.now, serviceInitStartedAt);
        const result = await service.resolve({
            question: businessQuery,
            recentContext,
        });
        input.timings.businessMs = measure(input.now, startedAt);
        input.retrievalTimingMs.business_system = input.timings.businessMs;
        if (result.kind === 'context') input.contextCandidates.push(result.candidate);
        if (result.kind !== 'skipped') input.service.writeBusinessResult(cacheKey, result, input.now());
        if (result.kind === 'fixed_reply') {
            addUniqueReason(input.degradedReasons, businessSystemDegradedReasonForStatus(result.status));
        }
        return result;
    } catch (error) {
        input.timings.businessMs = measure(input.now, startedAt);
        input.retrievalTimingMs.business_system = input.timings.businessMs;
        warnContextPreparationFailure('business_context', error, {
            source: input.request.source,
            decisionBusiness: input.decision.business,
            elapsedMs: input.timings.businessMs,
        });
        addUniqueReason(input.degradedReasons, 'business_system_unavailable');
        return toBusinessSystemFixedReply({ status: 'unavailable' });
    }
}

async function prepareMaterialContext(input: {
    service: WhatToSayContextPreparationService;
    request: WhatToSayContextPreparationInput;
    decision: ContextNeedDecision;
    ragReady: boolean;
    embeddingReady: boolean;
    contextCandidates: RealtimeContextCandidate[];
    citations: AnswerCitationRecord[];
    retrievalTimingMs: Partial<Record<RealtimeContextSource, number>>;
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
        source: input.request.source,
        modeEvent: input.request.modeEvent,
        decision: input.decision,
        ragReady: input.ragReady,
        embeddingReady: input.embeddingReady,
    });
    const cached = input.service.readMaterialContribution(cacheKey, input.now());
    if (cached) {
        const contribution = cached;
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
    const materialService = input.request.materialServiceFactory?.() || getDefaultMaterialService(input.service, input.request.ragManager);
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
    input.service.writeMaterialContribution(cacheKey, contribution, input.now());
    return {
        materialRagAttempted: contribution.sourceStatus.ragAttempted,
        uploadedMaterialHitCount: contribution.uploadedMaterialHitCount,
    };
}

async function prepareWhatToSayContextWithService(
    service: WhatToSayContextPreparationService,
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
    const retrievalTimingMs: Partial<Record<RealtimeContextSource, number>> = {};

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
        service,
        request: input,
        decision: contextNeedDecision,
        validatedImagePaths,
        providerScopes: input.providerScopes,
        degradedReasons,
        timings,
        now,
    });
    const businessPromise = prepareBusinessContext({
        service,
        request: input,
        decision: contextNeedDecision,
        contextCandidates,
        retrievalTimingMs,
        degradedReasons,
        timings,
        now,
    });
    const materialPromise = prepareMaterialContext({
        service,
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
        retrievalTimingMs,
        degradedReasons,
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

export async function prepareWhatToSayContext(
    input: WhatToSayContextPreparationInput,
): Promise<WhatToSayContextPreparationResult> {
    return WhatToSayContextPreparationService.getInstance().prepare(input);
}
