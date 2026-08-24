import type { LLMHelper } from '../../LLMHelper';
import type { DatabaseManager, Meeting } from '../../db/DatabaseManager';
import type {
    HistoryCandidate,
    MeetingContext,
    ModeRecommendation,
    PrepareContextResult,
} from '../../../shared/meetingPreparation';
import type { KnowledgeMaterialService } from '../knowledge/KnowledgeMaterialService';
import type { ModesManager } from '../ModesManager';
import {
    extractAndParse,
    meetingContextSchema,
    modeRecommendationSchema,
} from './MeetingPreparationSchemas';
import { buildMeetingContextPrompt, buildModePrompt } from './MeetingPreparationPrompts';

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
            return extractAndParse(raw, meetingContextSchema);
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
}
