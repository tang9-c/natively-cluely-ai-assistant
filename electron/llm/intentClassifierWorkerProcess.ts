import {
    getAnswerShapeForMode,
    getLabelMapForMode,
    isPrimarilyChinese,
    SLM_CONFIDENCE_THRESHOLD,
} from './IntentClassifierShared';
import {
    INTENT_CLASSIFIER_MODEL_ARTIFACT,
    assertIntentClassifierModelArtifact,
    buildIntentClassifierPipelineOptions,
} from './IntentClassifierModelArtifact';
import type { IntentResult } from './IntentClassifierShared';

type WorkerRequest =
    | {
        id: number;
        type: 'classify';
        text: string;
        modeTemplateType?: string | null;
        cacheDir: string;
        remoteHost: string;
      }
    | {
        id: number;
        type: 'warmup';
        cacheDir: string;
        remoteHost: string;
      };

type PipelineFn = (
    text: string,
    labels: string[],
    options: { multi_label: boolean },
) => Promise<{ labels: string[]; scores: number[] }>;

let pipe: PipelineFn | null = null;
let loadingPromise: Promise<void> | null = null;
let loadFailed = false;

// @huggingface/transformers 3.8.1 declares onnxruntime-node@1.21.0, while
// the app may override it for other native ONNX paths. Treat a native binding
// load failure as a disabled optional enhancement rather than letting the
// isolated worker crash during Transformers.js import.
const TRANSFORMERS_EXPECTED_ONNXRUNTIME_NODE = '1.21.0';

function send(message: unknown): void {
    if (typeof process.send === 'function') {
        process.send(message);
    }
}

function preflightOnnxRuntimeNode(): { ok: true; installedVersion: string } | { ok: false; error: string } {
    try {
        const runtimeRequire = new Function('specifier', 'return require(specifier)') as (specifier: string) => any;
        const ort = runtimeRequire('onnxruntime-node');
        const installedVersion = runtimeRequire('onnxruntime-node/package.json')?.version ?? 'unknown';
        if (typeof ort?.InferenceSession?.create !== 'function') {
            return {
                ok: false,
                error: `onnxruntime-node ${installedVersion} loaded without InferenceSession.create`,
            };
        }
        if (installedVersion !== TRANSFORMERS_EXPECTED_ONNXRUNTIME_NODE) {
            console.warn('[IntentClassifierWorker] onnxruntime-node version differs from Transformers.js pin', {
                installedVersion,
                expectedVersion: TRANSFORMERS_EXPECTED_ONNXRUNTIME_NODE,
            });
        }
        return { ok: true, installedVersion };
    } catch (error) {
        return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        };
    }
}

async function ensureLoaded(cacheDir: string, remoteHost: string): Promise<void> {
    if (pipe || loadFailed) return;
    if (loadingPromise) {
        await loadingPromise;
        return;
    }

    loadingPromise = (async () => {
        try {
            const ortPreflight = preflightOnnxRuntimeNode();
            if (ortPreflight.ok === false) {
                throw new Error(`onnxruntime-node preflight failed before Transformers.js import: ${ortPreflight.error}`);
            }

            const { pipeline, env } = await new Function("return import('@huggingface/transformers')")();

            env.allowRemoteModels = true;
            env.cacheDir = cacheDir;
            env.remoteHost = remoteHost;

            const pipelineOptions = buildIntentClassifierPipelineOptions();
            console.log('[IntentClassifierWorker] Loading zero-shot classifier', {
                modelId: INTENT_CLASSIFIER_MODEL_ARTIFACT.modelId,
                dtype: pipelineOptions.dtype,
                modelFileName: pipelineOptions.model_file_name,
                onnxRuntimeNodeVersion: ortPreflight.installedVersion,
            });

            pipe = await pipeline(
                INTENT_CLASSIFIER_MODEL_ARTIFACT.task,
                INTENT_CLASSIFIER_MODEL_ARTIFACT.modelId,
                pipelineOptions,
            );
            const artifact = assertIntentClassifierModelArtifact(cacheDir);
            console.log('[IntentClassifierWorker] Quantized artifact verified', {
                bytes: artifact.bytes,
                required: INTENT_CLASSIFIER_MODEL_ARTIFACT.requiredRelativePath,
            });
        } catch (error) {
            loadFailed = true;
            pipe = null;
            throw error;
        }
    })();

    try {
        await loadingPromise;
    } finally {
        loadingPromise = null;
    }
}

async function classify(request: Extract<WorkerRequest, { type: 'classify' }>): Promise<IntentResult | null> {
    await ensureLoaded(request.cacheDir, request.remoteHost);
    if (!pipe) return null;

    const isChinese = isPrimarilyChinese(request.text);
    const labelMap = getLabelMapForMode(request.modeTemplateType, isChinese);
    const labelKeys = Object.keys(labelMap);
    const result = await pipe(request.text, labelKeys, { multi_label: false });
    const topLabel = result.labels[0];
    const topScore = result.scores[0];

    if (topScore < SLM_CONFIDENCE_THRESHOLD) {
        return null;
    }

    const intent = labelMap[topLabel] || 'general';
    console.log('[IntentClassifierWorker] SLM classified', {
        intent,
        confidence: topScore,
        textLength: request.text.length,
    });

    return {
        intent,
        confidence: topScore,
        answerShape: getAnswerShapeForMode(request.modeTemplateType, intent),
    };
}

process.on('message', async (request: WorkerRequest) => {
    try {
        if (request.type === 'warmup') {
            await ensureLoaded(request.cacheDir, request.remoteHost);
            send({ id: request.id, ok: true, warmed: true });
            return;
        }

        const result = await classify(request);
        send({ id: request.id, ok: true, result });
    } catch (error) {
        send({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
    }
});
