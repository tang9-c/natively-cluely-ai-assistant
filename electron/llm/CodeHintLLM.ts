import { LLMHelper } from "../LLMHelper";
import type { AnswerDegradedReason } from "../db/DatabaseManager";
import {
    getDeniedDataScopes,
    type ProviderDataScope,
    type ProviderDataScopePolicy,
} from "./ProviderRouter";
import { CODE_HINT_PROMPT, buildCodeHintMessage } from "./prompts";
import { TINY_CODE_HINT_PROMPT } from "./tinyPrompts";

export interface CodeHintSourceStatus {
    screenContextStatus: 'available' | 'blocked' | 'failed' | 'not_used';
    transcriptStatus: 'available' | 'blocked' | 'not_used';
}

export interface CodeHintTrace {
    entrypoint: 'code_hint';
    status: 'generated' | 'generated_with_fallback' | 'blocked' | 'failed';
    dataScopesRequested: ProviderDataScope[];
    dataScopesDenied: ProviderDataScope[];
    usedContextSources: Array<'screenshots' | 'transcript'>;
    sourceStatus: CodeHintSourceStatus;
    degradedReasons: AnswerDegradedReason[];
    usedVision: boolean;
    usedTranscript: boolean;
    provider?: string;
}

export type CodeHintTraceSink = (trace: CodeHintTrace) => void;

export interface CodeHintGenerateOptions {
    providerScopePolicy?: ProviderDataScopePolicy;
    requestedDataScopes?: ProviderDataScope[];
    traceSink?: CodeHintTraceSink;
}

export class CodeHintLLM {
    private llmHelper: LLMHelper;

    constructor(llmHelper: LLMHelper) {
        this.llmHelper = llmHelper;
    }

    private emitTrace(traceSink: CodeHintTraceSink | undefined, trace: CodeHintTrace): void {
        try {
            traceSink?.(trace);
        } catch {
            // Diagnostics must never change CodeHint behavior.
        }
    }

    async *generateStream(
        imagePaths?: string[],
        questionContext?: string,
        questionSource?: 'screenshot' | 'transcript' | null,
        transcriptContext?: string,
        options?: CodeHintGenerateOptions
    ): AsyncGenerator<string> {
        const requestedScopes: ProviderDataScope[] = [];
        const hasScreenshots = Boolean(imagePaths?.length) || questionSource === 'screenshot';
        const hasTranscript = questionSource === 'transcript' || Boolean(transcriptContext?.trim());
        if (hasScreenshots) requestedScopes.push('screenshots');
        if (hasTranscript) requestedScopes.push('transcript');
        for (const scope of options?.requestedDataScopes ?? []) {
            if (!requestedScopes.includes(scope)) requestedScopes.push(scope);
        }

        const deniedScopes = getDeniedDataScopes(requestedScopes, options?.providerScopePolicy);
        const screenshotsDenied = deniedScopes.includes('screenshots');
        const transcriptDenied = deniedScopes.includes('transcript');
        const degradedReasons: AnswerDegradedReason[] = [];

        let safeImagePaths = imagePaths;
        let safeQuestionContext = questionContext;
        let safeQuestionSource = questionSource;
        let safeTranscriptContext = transcriptContext;

        if (screenshotsDenied) {
            safeImagePaths = undefined;
            if (safeQuestionSource === 'screenshot') {
                safeQuestionContext = undefined;
                safeQuestionSource = null;
            }
            degradedReasons.push('screen_context_scope_blocked');
        }

        if (transcriptDenied) {
            if (safeQuestionSource === 'transcript') {
                safeQuestionContext = undefined;
                safeQuestionSource = null;
            }
            safeTranscriptContext = undefined;
            degradedReasons.push('context_scope_denied');
        }

        const usesVision = Boolean(safeImagePaths?.length);
        const usesTranscript = safeQuestionSource === 'transcript' || Boolean(safeTranscriptContext?.trim());
        const usedContextSources: Array<'screenshots' | 'transcript'> = [];
        if (usesVision) usedContextSources.push('screenshots');
        if (usesTranscript) usedContextSources.push('transcript');
        const provider = this.llmHelper.getCurrentProvider?.();

        const sourceStatus = (): CodeHintSourceStatus => ({
            screenContextStatus: screenshotsDenied ? 'blocked' : usesVision ? 'available' : 'not_used',
            transcriptStatus: transcriptDenied ? 'blocked' : usesTranscript ? 'available' : 'not_used',
        });

        if (requestedScopes.length > 0 && usedContextSources.length === 0) {
            this.emitTrace(options?.traceSink, {
                entrypoint: 'code_hint',
                status: 'blocked',
                dataScopesRequested: requestedScopes,
                dataScopesDenied: deniedScopes,
                usedContextSources,
                sourceStatus: sourceStatus(),
                degradedReasons,
                usedVision: false,
                usedTranscript: false,
                provider,
            });
            yield "Code hint is blocked by the current data scope settings. Enable screen or transcript access for this provider to generate a hint.";
            return;
        }

        try {
            // Vision-required + small model lacking image support → fail loud, not malformed.
            if (safeImagePaths?.length) {
                const caps = this.llmHelper.getCapabilities();
                if (!caps.supportsImages) {
                    const fallbackReasons: AnswerDegradedReason[] = [
                        ...degradedReasons,
                        'screen_context_no_vision_provider',
                    ];
                    this.emitTrace(options?.traceSink, {
                        entrypoint: 'code_hint',
                        status: 'generated_with_fallback',
                        dataScopesRequested: requestedScopes,
                        dataScopesDenied: deniedScopes,
                        usedContextSources,
                        sourceStatus: {
                            ...sourceStatus(),
                            screenContextStatus: 'failed',
                        },
                        degradedReasons: fallbackReasons,
                        usedVision: false,
                        usedTranscript: usesTranscript,
                        provider,
                    });
                    yield `The current local model (${caps.name}) doesn't support image input. Switch to a vision-capable model (e.g. llava, llama3.2-vision, gemma3) or use a cloud model.`;
                    return;
                }
            }

            const message = buildCodeHintMessage(
                safeQuestionContext ?? null,
                safeQuestionSource ?? null,
                safeTranscriptContext ?? null
            );

            const promptOverride = this.llmHelper.getPromptTier() === 'tiny' ? TINY_CODE_HINT_PROMPT : CODE_HINT_PROMPT;
            const fittedMessage = this.llmHelper.fitContextForCurrentModel(message);

            yield* this.llmHelper.streamChat(
                fittedMessage,
                safeImagePaths,
                undefined,
                promptOverride
            );
            this.emitTrace(options?.traceSink, {
                entrypoint: 'code_hint',
                status: degradedReasons.length > 0 ? 'generated_with_fallback' : 'generated',
                dataScopesRequested: requestedScopes,
                dataScopesDenied: deniedScopes,
                usedContextSources,
                sourceStatus: sourceStatus(),
                degradedReasons,
                usedVision: usesVision,
                usedTranscript: usesTranscript,
                provider,
            });
        } catch (error) {
            console.error("[CodeHintLLM] Stream failed:", {
                errorClass: error instanceof Error ? error.name : typeof error,
            });
            this.emitTrace(options?.traceSink, {
                entrypoint: 'code_hint',
                status: 'failed',
                dataScopesRequested: requestedScopes,
                dataScopesDenied: deniedScopes,
                usedContextSources,
                sourceStatus: {
                    ...sourceStatus(),
                    screenContextStatus: usesVision ? 'failed' : sourceStatus().screenContextStatus,
                },
                degradedReasons: [...degradedReasons, 'screen_context_failed'],
                usedVision: usesVision,
                usedTranscript: usesTranscript,
                provider,
            });
            yield "I couldn't analyze the screenshot. Make sure your code is visible and try again.";
        }
    }
}
