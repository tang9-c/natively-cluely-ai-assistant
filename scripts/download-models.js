const path = require('path');
const fs = require('fs');

async function downloadModels() {
    const { pipeline, env } = await import('@huggingface/transformers');
    const modelsDir = path.join(__dirname, '../resources/models');
    
    // Ensure the directory exists
    if (!fs.existsSync(modelsDir)) {
        fs.mkdirSync(modelsDir, { recursive: true });
    }

    // Let Transformers.js handle the download but specify the local directory cache
    env.cacheDir = modelsDir;
    
    try {
        // 1. Embedding model (RAG)
        console.log('[download-models] Downloading Xenova/paraphrase-multilingual-MiniLM-L12-v2...');
        await pipeline('feature-extraction', 'Xenova/paraphrase-multilingual-MiniLM-L12-v2', {
            model_file_name: 'model_int8',
        });
        console.log('[download-models] paraphrase-multilingual-MiniLM-L12-v2 downloaded.');

        // 2. Zero-shot classification model (Intent Classifier)
        // Transformers.js v3 defaults to fp32 on CPU unless dtype is explicit.
        // Keep this pinned to model_int8.onnx so install never pulls the 1GB
        // fp32 mdeberta artifact by accident.
        console.log('[download-models] Downloading Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7 (int8)...');
        await pipeline('zero-shot-classification', 'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7', {
            model_file_name: 'model',
            dtype: 'int8',
        });
        const intentArtifact = path.join(
            modelsDir,
            'Xenova/mdeberta-v3-base-xnli-multilingual-nli-2mil7',
            'onnx/model_int8.onnx',
        );
        if (!fs.existsSync(intentArtifact)) {
            throw new Error('Intent classifier int8 artifact missing after download: onnx/model_int8.onnx');
        }
        const intentBytes = fs.statSync(intentArtifact).size;
        if (intentBytes > 512 * 1024 * 1024) {
            throw new Error(`Intent classifier artifact is too large for int8: ${intentBytes} bytes`);
        }
        console.log('[download-models] mdeberta multilingual intent classifier int8 downloaded.');

        console.log('[download-models] All models downloaded successfully!');
    } catch (e) {
        console.error('[download-models] Error downloading model:', e);
        process.exit(1);
    }
}

downloadModels().catch((e) => {
    console.error('[download-models] Fatal error:', e);
    process.exit(1);
});
