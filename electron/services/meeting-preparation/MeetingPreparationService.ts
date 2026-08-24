import * as crypto from 'crypto';
import type { LLMHelper } from '../../LLMHelper';
import type { DatabaseManager, Meeting } from '../../db/DatabaseManager';
import type {
    HistoryCandidate,
    MeetingContext,
    MeetingPreparationRecord,
    ModeRecommendation,
    PrepareContextResult,
    PreparationEvidence,
    PreparationQuestion,
} from '../../../shared/meetingPreparation';
import type {
    KnowledgeMaterialSearchResult,
    KnowledgeMaterialService,
} from '../knowledge/KnowledgeMaterialService';
import type { ModesManager } from '../ModesManager';
import {
    evidenceCoverageSchema,
    extractAndParse,
    generationBundleSchema,
    meetingContextSchema,
    modeRecommendationSchema,
    type PredictedQuestion,
} from './MeetingPreparationSchemas';
import {
    buildEvidencePrompt,
    buildMeetingContextPrompt,
    buildModePrompt,
    buildPredictionPrompt,
} from './MeetingPreparationPrompts';

type PreparationDatabase = Pick<
    DatabaseManager,
    | 'getMeetingPreparation'
    | 'getRecentMeetings'
    | 'getMeetingDetails'
    | 'saveMeetingPreparationResult'
    | 'saveMeetingPreparation'
>;

interface MeetingPreparationDependencies {
    db: PreparationDatabase;
    llm: Pick<LLMHelper, 'generateContentStructured'>;
    modes: Pick<ModesManager, 'getModes' | 'setActiveMode'>;
    materials: Pick<KnowledgeMaterialService, 'searchWithDiagnostics'>;
}

const normalizeForMatch = (value: string): string =>
    value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');

const meetingMatchScore = (meeting: Meeting, customer: string): number => {
    if (!customer) return 0;
    const normalizedTitle = normalizeForMatch(meeting.title ?? '');
    const normalizedSummary = normalizeForMatch(meeting.summary ?? '');
    return (normalizedTitle.includes(customer) ? 2 : 0) + (normalizedSummary.includes(customer) ? 1 : 0);
};

const throwIfAborted = (signal: AbortSignal): void => {
    if (!signal.aborted) return;
    if (signal.reason instanceof Error) throw signal.reason;
    throw new Error('meeting_preparation_cancelled');
};

export class MeetingPreparationService {
    private readonly activeOperations = new Map<string, AbortController>();

    constructor(private readonly deps: MeetingPreparationDependencies) {}

    private async runExclusive<T>(
        id: string,
        external: AbortSignal | undefined,
        work: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        if (this.activeOperations.has(id)) throw new Error('meeting_preparation_busy');

        const controller = new AbortController();
        const abort = () => controller.abort(external?.reason);
        if (external?.aborted) abort();
        else external?.addEventListener('abort', abort, { once: true });
        this.activeOperations.set(id, controller);
        try {
            return await work(controller.signal);
        } finally {
            external?.removeEventListener('abort', abort);
            this.activeOperations.delete(id);
        }
    }

    public cancelOperation(id: string): boolean {
        const controller = this.activeOperations.get(id);
        if (!controller) return false;
        controller.abort(new Error('meeting_preparation_cancelled'));
        return true;
    }

    public async parseInput(
        preparationId: string,
        rawInput: string,
        externalSignal?: AbortSignal,
    ): Promise<MeetingContext> {
        const trimmed = rawInput.trim();
        if (!trimmed || rawInput.length > 20_000) throw new Error('invalid_meeting_preparation_input');

        return this.runExclusive(preparationId, externalSignal, async (signal) => {
            const raw = await this.deps.llm.generateContentStructured(
                buildMeetingContextPrompt(trimmed),
                {
                    taskLabel: 'meeting-preparation-parse',
                    providerStrategy: 'selected_model_only',
                    dataScopes: ['transcript'],
                    abortSignal: signal,
                },
            );
            try {
                return extractAndParse(raw, meetingContextSchema);
            } catch (error) {
                const issues = error && typeof error === 'object' && 'issues' in error
                    && Array.isArray((error as { issues?: unknown[] }).issues)
                    ? (error as { issues: Array<{ path?: unknown[]; code?: string }> }).issues
                        .slice(0, 8)
                        .map((issue) => ({
                            path: Array.isArray(issue.path) ? issue.path.join('.') : '',
                            code: issue.code ?? 'unknown',
                        }))
                    : [];
                console.warn('[MeetingPreparation] Structured parse output rejected', {
                    errorType: error instanceof Error ? error.name : 'unknown',
                    issues,
                });
                throw error;
            }
        });
    }

    public async prepareContext(
        preparationId: string,
        context: MeetingContext,
        externalSignal?: AbortSignal,
    ): Promise<PrepareContextResult> {
        return this.runExclusive(preparationId, externalSignal, async (signal) => {
            const allowedModes = this.deps.modes
                .getModes()
                .filter((mode) => mode.templateType === 'sales' || mode.templateType === 'fde');
            if (allowedModes.length === 0) throw new Error('meeting_preparation_modes_unavailable');

            const raw = await this.deps.llm.generateContentStructured(
                buildModePrompt(context, allowedModes),
                {
                    taskLabel: 'meeting-preparation-mode',
                    providerStrategy: 'selected_model_only',
                    dataScopes: ['transcript'],
                    abortSignal: signal,
                },
            );
            const recommendation = extractAndParse(raw, modeRecommendationSchema);
            const selectedMode = allowedModes.find(
                (mode) => mode.templateType === recommendation.templateType,
            );
            if (!selectedMode) throw new Error('meeting_preparation_invalid_mode');

            const modeRecommendation: ModeRecommendation = {
                modeId: selectedMode.id,
                templateType: recommendation.templateType,
                label: selectedMode.name,
                reason: recommendation.reason,
                focus: recommendation.focus,
            };

            let historyCandidates: HistoryCandidate[] = [];
            let historyUnavailable = false;
            try {
                const customer = normalizeForMatch(context.customer.value);
                historyCandidates = this.deps.db
                    .getRecentMeetings(50)
                    .map((meeting) => ({ meeting, score: meetingMatchScore(meeting, customer) }))
                    .sort((left, right) => {
                        if (left.score !== right.score) return right.score - left.score;
                        return Date.parse(right.meeting.date) - Date.parse(left.meeting.date);
                    })
                    .slice(0, 5)
                    .map(({ meeting, score }) => ({
                        id: meeting.id,
                        title: meeting.title,
                        date: meeting.date,
                        summary: meeting.summary,
                        matchReason: score > 0 ? '客户名称匹配' : '近期会议',
                    }));
            } catch {
                historyUnavailable = true;
            }

            const record = this.deps.db.getMeetingPreparation(preparationId);
            if (record) {
                this.deps.db.saveMeetingPreparation({
                    ...record,
                    meetingContext: context,
                    selectedModeId: selectedMode.id,
                    result: {
                        ...record.result,
                        modeRecommendation,
                    },
                });
            }

            return { modeRecommendation, historyCandidates, historyUnavailable };
        });
    }

    private toQuestion(
        question: PredictedQuestion,
        evidenceStatus: PreparationQuestion['evidenceStatus'],
        evidence: PreparationEvidence,
        checkedAt: string,
        identity?: { id: string; sortOrder: number },
    ): PreparationQuestion {
        return {
            id: identity?.id ?? `question_${crypto.randomUUID()}`,
            sortOrder: identity?.sortOrder ?? 0,
            question: question.question,
            keyMomentType: question.keyMomentType,
            rationale: question.rationale,
            evidenceStatus,
            evidence,
            checkedAt,
        };
    }

    private async evaluateCoverage(
        question: PredictedQuestion,
        hits: KnowledgeMaterialSearchResult[],
        signal: AbortSignal,
    ) {
        const raw = await this.deps.llm.generateContentStructured(
            buildEvidencePrompt(question, hits),
            {
                taskLabel: 'meeting-preparation-evidence',
                providerStrategy: 'selected_model_only',
                dataScopes: ['reference_files'],
                abortSignal: signal,
            },
        );
        return extractAndParse(raw, evidenceCoverageSchema);
    }

    private async checkEvidence(
        question: PredictedQuestion,
        signal: AbortSignal,
        identity?: { id: string; sortOrder: number },
    ): Promise<PreparationQuestion> {
        const checkedAt = new Date().toISOString();
        if (!question.requiresInternalEvidence) {
            return this.toQuestion(
                question,
                'not_needed',
                {
                    knowledgeRequirements: question.knowledgeRequirements,
                    supported: [],
                    missing: [],
                    limitations: ['该问题主要依赖现场信息'],
                    citations: [],
                    handlingScript: '',
                    followupQuestions: [],
                },
                checkedAt,
                identity,
            );
        }

        try {
            const response = await this.deps.materials.searchWithDiagnostics(
                [question.question, ...question.knowledgeRequirements].join('\n'),
                { limit: 6, candidateLimit: 200, hybridTimeoutMs: 1500 },
            );
            throwIfAborted(signal);
            if (response.hits.length === 0) {
                return this.toQuestion(
                    question,
                    'missing',
                    {
                        knowledgeRequirements: question.knowledgeRequirements,
                        supported: [],
                        missing: question.knowledgeRequirements,
                        limitations: [],
                        citations: [],
                        handlingScript: '这个问题需要结合贵方场景进一步确认，我会在会后补充经过核对的资料。',
                        followupQuestions: ['您最关注该问题的哪个具体场景？'],
                    },
                    checkedAt,
                    identity,
                );
            }

            const coverage = await this.evaluateCoverage(question, response.hits, signal);
            throwIfAborted(signal);
            const allowed = new Map(response.hits.map((hit) => [hit.chunkId, hit]));
            const citations = [...new Set(coverage.citedChunkIds)]
                .filter((chunkId) => allowed.has(chunkId))
                .map((chunkId) => {
                    const hit = allowed.get(chunkId)!;
                    return {
                        sourceType: 'uploaded_material' as const,
                        sourceId: hit.sourceId,
                        title: hit.title,
                        chunkId: hit.chunkId,
                    };
                });
            const status = coverage.coverage === 'sufficient' && citations.length > 0
                ? 'sufficient'
                : 'partial';
            return this.toQuestion(
                question,
                status,
                {
                    knowledgeRequirements: question.knowledgeRequirements,
                    supported: coverage.supported,
                    missing: coverage.missing,
                    limitations: coverage.limitations,
                    citations,
                    handlingScript: coverage.handlingScript,
                    followupQuestions: coverage.followupQuestions,
                },
                checkedAt,
                identity,
            );
        } catch {
            throwIfAborted(signal);
            return this.toQuestion(
                question,
                null,
                {
                    knowledgeRequirements: question.knowledgeRequirements,
                    supported: [],
                    missing: [],
                    limitations: [],
                    citations: [],
                    handlingScript: '',
                    followupQuestions: [],
                    checkError: 'check_failed',
                },
                checkedAt,
                identity,
            );
        }
    }

    private compactHistory(meeting: Meeting | null): unknown | null {
        if (!meeting) return null;
        return {
            id: meeting.id,
            title: meeting.title,
            date: meeting.date,
            summary: meeting.summary,
            detailedSummary: meeting.detailedSummary,
            transcript: meeting.transcript
                ?.map((entry) => ({ speaker: entry.speaker, text: entry.text, timestamp: entry.timestamp }))
                .slice(-200),
        };
    }

    public async generate(
        preparationId: string,
        externalSignal?: AbortSignal,
    ): Promise<MeetingPreparationRecord> {
        return this.runExclusive(preparationId, externalSignal, async (signal) => {
            const record = this.deps.db.getMeetingPreparation(preparationId);
            if (!record?.meetingContext || !record.selectedModeId) {
                throw new Error('meeting_preparation_incomplete');
            }
            const selectedMode = this.deps.modes.getModes().find(
                (mode) => mode.id === record.selectedModeId
                    && (mode.templateType === 'sales' || mode.templateType === 'fde'),
            );
            if (!selectedMode) throw new Error('meeting_preparation_invalid_mode');
            const selectedTemplateType = selectedMode.templateType;
            if (selectedTemplateType !== 'sales' && selectedTemplateType !== 'fde') {
                throw new Error('meeting_preparation_invalid_mode');
            }

            const historyMeeting = record.linkedMeetingId
                ? this.deps.db.getMeetingDetails(record.linkedMeetingId)
                : null;
            const history = this.compactHistory(historyMeeting);
            const dataScopes: Array<'transcript' | 'profile_history'> = history
                ? ['transcript', 'profile_history']
                : ['transcript'];
            const raw = await this.deps.llm.generateContentStructured(
                buildPredictionPrompt(record.meetingContext, {
                    id: selectedMode.id,
                    name: selectedMode.name,
                    templateType: selectedTemplateType,
                }, history),
                {
                    taskLabel: 'meeting-preparation-predict',
                    providerStrategy: 'selected_model_only',
                    dataScopes,
                    abortSignal: signal,
                },
            );
            const bundle = extractAndParse(raw, generationBundleSchema);
            throwIfAborted(signal);

            const questions: PreparationQuestion[] = [];
            for (let index = 0; index < bundle.questions.length; index += 1) {
                const checked = await this.checkEvidence(bundle.questions[index], signal);
                questions.push({ ...checked, sortOrder: index });
            }
            throwIfAborted(signal);

            const hasLinkedHistory = Boolean(record.linkedMeetingId && historyMeeting);
            return this.deps.db.saveMeetingPreparationResult(
                preparationId,
                {
                    modeRecommendation: record.result.modeRecommendation,
                    historySummary: hasLinkedHistory ? bundle.historySummary : [],
                    commitments: hasLinkedHistory
                        ? bundle.commitments.map((commitment) => ({
                            text: commitment.text,
                            sourceMeetingId: record.linkedMeetingId!,
                            status: 'needs_confirmation' as const,
                        }))
                        : [],
                },
                questions,
            );
        });
    }

    public async recheckQuestion(
        preparationId: string,
        questionId: string,
        externalSignal?: AbortSignal,
    ): Promise<MeetingPreparationRecord> {
        return this.runExclusive(preparationId, externalSignal, async (signal) => {
            const record = this.deps.db.getMeetingPreparation(preparationId);
            if (!record) throw new Error('meeting_preparation_not_found');
            const questionIndex = record.questions.findIndex((question) => question.id === questionId);
            if (questionIndex < 0) throw new Error('meeting_preparation_question_not_found');

            const current = record.questions[questionIndex];
            const rechecked = await this.checkEvidence(
                {
                    question: current.question,
                    keyMomentType: current.keyMomentType,
                    rationale: current.rationale,
                    knowledgeRequirements: current.evidence.knowledgeRequirements,
                    requiresInternalEvidence: current.evidenceStatus !== 'not_needed',
                },
                signal,
                { id: current.id, sortOrder: current.sortOrder },
            );
            throwIfAborted(signal);

            const questions = record.questions.map((question, index) =>
                index === questionIndex ? rechecked : question,
            );
            return this.deps.db.saveMeetingPreparation({ ...record, questions });
        });
    }
}
