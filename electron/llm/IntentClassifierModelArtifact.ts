import fs from 'fs';
import path from 'path';

export interface IntentClassifierModelArtifact {
    modelId: string;
    task: 'zero-shot-classification';
    modelFileName: string;
    dtype: 'int8';
    requiredRelativePath: string;
    forbiddenFp32RelativePath: string;
    maxBytes: number;
}

export interface ModelArtifactValidationResult {
    ok: boolean;
    path?: string;
    bytes?: number;
    error?: string;
}

const MiB = 1024 * 1024;

export const INTENT_CLASSIFIER_MODEL_ARTIFACT: IntentClassifierModelArtifact = {
    modelId: 'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7',
    task: 'zero-shot-classification',
    modelFileName: 'model',
    dtype: 'int8',
    requiredRelativePath: 'onnx/model_int8.onnx',
    forbiddenFp32RelativePath: 'onnx/model.onnx',
    // The fp32 artifact observed in the crash path is ~1.0GB. Keep this cap
    // comfortably above the expected quantized size while rejecting fp32.
    maxBytes: 512 * MiB,
};

export function buildIntentClassifierPipelineOptions(): {
    local_files_only: false;
    model_file_name: string;
    dtype: string;
} {
    return {
        local_files_only: false,
        model_file_name: INTENT_CLASSIFIER_MODEL_ARTIFACT.modelFileName,
        dtype: INTENT_CLASSIFIER_MODEL_ARTIFACT.dtype,
    };
}

export function getIntentClassifierRequiredArtifactPath(cacheDir: string): string {
    return path.join(
        cacheDir,
        INTENT_CLASSIFIER_MODEL_ARTIFACT.modelId,
        INTENT_CLASSIFIER_MODEL_ARTIFACT.requiredRelativePath,
    );
}

export function validateIntentClassifierModelArtifact(cacheDir: string): ModelArtifactValidationResult {
    const artifactPath = getIntentClassifierRequiredArtifactPath(cacheDir);
    if (!fs.existsSync(artifactPath)) {
        const fp32Path = path.join(
            cacheDir,
            INTENT_CLASSIFIER_MODEL_ARTIFACT.modelId,
            INTENT_CLASSIFIER_MODEL_ARTIFACT.forbiddenFp32RelativePath,
        );
        const fp32Hint = fs.existsSync(fp32Path)
            ? ` Found fp32 artifact at ${INTENT_CLASSIFIER_MODEL_ARTIFACT.forbiddenFp32RelativePath}; it is not accepted.`
            : '';
        return {
            ok: false,
            error: `Required quantized intent classifier artifact missing: ${INTENT_CLASSIFIER_MODEL_ARTIFACT.requiredRelativePath}.${fp32Hint}`,
        };
    }

    const stat = fs.statSync(artifactPath);
    if (stat.size <= 0) {
        return {
            ok: false,
            path: artifactPath,
            bytes: stat.size,
            error: `Quantized intent classifier artifact is empty: ${artifactPath}`,
        };
    }

    if (stat.size > INTENT_CLASSIFIER_MODEL_ARTIFACT.maxBytes) {
        return {
            ok: false,
            path: artifactPath,
            bytes: stat.size,
            error: `Quantized intent classifier artifact is too large (${stat.size} bytes): ${artifactPath}`,
        };
    }

    return {
        ok: true,
        path: artifactPath,
        bytes: stat.size,
    };
}

export function assertIntentClassifierModelArtifact(cacheDir: string): ModelArtifactValidationResult {
    const result = validateIntentClassifierModelArtifact(cacheDir);
    if (!result.ok) {
        throw new Error(result.error ?? 'Invalid intent classifier model artifact');
    }
    return result;
}
