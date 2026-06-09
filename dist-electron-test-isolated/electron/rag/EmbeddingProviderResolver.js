"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EmbeddingProviderResolver = void 0;
const OpenAIEmbeddingProvider_1 = require("./providers/OpenAIEmbeddingProvider");
const GeminiEmbeddingProvider_1 = require("./providers/GeminiEmbeddingProvider");
const OllamaEmbeddingProvider_1 = require("./providers/OllamaEmbeddingProvider");
const LocalEmbeddingProvider_1 = require("./providers/LocalEmbeddingProvider");
const DoubaoEmbeddingProvider_1 = require("./providers/DoubaoEmbeddingProvider");
const ProviderRouter_1 = require("../llm/ProviderRouter");
class EmbeddingProviderResolver {
    /** Cloud providers get a bounded probe-retry before we demote (hysteresis). */
    static CLOUD_PROBE_ATTEMPTS = 3;
    static CLOUD_PROBE_BACKOFF_MS = 400;
    static CLOUD_PROVIDER_NAMES = new Set(['openai', 'gemini']);
    /**
     * Probe a provider's availability. For CLOUD providers (which require a real
     * billed network round-trip), retry a few times with short backoff so a single
     * transient 429 / timeout / network blip does NOT demote to the next candidate.
     *
     * WHY THIS MATTERS for the embedding-space migration: a spurious demotion
     * (gemini → ollama) changes the active embedding SPACE, which persists to
     * `last_embedding_space` and triggers a FULL billed re-index of the entire
     * corpus — then reverts on the next launch when the cloud provider returns.
     * Stabilizing the probe keeps the active space stable and avoids the thrash.
     * Local/Ollama probes are cheap + deterministic, so they aren't retried.
     */
    static async probeAvailable(provider) {
        const isCloud = EmbeddingProviderResolver.CLOUD_PROVIDER_NAMES.has(provider.name);
        const attempts = isCloud ? EmbeddingProviderResolver.CLOUD_PROBE_ATTEMPTS : 1;
        for (let i = 1; i <= attempts; i++) {
            if (await provider.isAvailable())
                return true;
            if (i < attempts) {
                console.log(`[EmbeddingProviderResolver] ${provider.name} probe ${i}/${attempts} failed — retrying (avoids spurious space-thrash demotion)...`);
                await new Promise(r => setTimeout(r, EmbeddingProviderResolver.CLOUD_PROBE_BACKOFF_MS * i));
            }
        }
        return false;
    }
    /**
     * Returns the best available provider.
     * Runs isAvailable() checks in priority order.
     * Local model is the unconditional fallback — always last.
     */
    static async resolve(config) {
        const candidates = [];
        let embeddingsDenied = false;
        if (config.doubaoKey) {
            try {
                (0, ProviderRouter_1.assertProviderDataScopes)('doubao_embeddings', ['embeddings'], config.providerDataScopes);
                // Use configured endpoint ID, then env var, then default
                const doubaoModel = config.doubaoEmbeddingModel || process.env.DOUBAO_EMBEDDING_MODEL || undefined;
                candidates.push(new DoubaoEmbeddingProvider_1.DoubaoEmbeddingProvider(config.doubaoKey, doubaoModel));
            }
            catch (error) {
                if (error instanceof ProviderRouter_1.ProviderScopeError) {
                    embeddingsDenied = true;
                    console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
                }
                else {
                    throw error;
                }
            }
        }
        if (config.openaiKey) {
            try {
                (0, ProviderRouter_1.assertProviderDataScopes)('openai_embeddings', ['embeddings'], config.providerDataScopes);
                candidates.push(new OpenAIEmbeddingProvider_1.OpenAIEmbeddingProvider(config.openaiKey));
            }
            catch (error) {
                if (error instanceof ProviderRouter_1.ProviderScopeError) {
                    embeddingsDenied = true;
                    console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
                }
                else {
                    throw error;
                }
            }
        }
        if (config.geminiKey) {
            try {
                (0, ProviderRouter_1.assertProviderDataScopes)('gemini_embeddings', ['embeddings'], config.providerDataScopes);
                candidates.push(new GeminiEmbeddingProvider_1.GeminiEmbeddingProvider(config.geminiKey));
            }
            catch (error) {
                if (error instanceof ProviderRouter_1.ProviderScopeError) {
                    embeddingsDenied = true;
                    console.warn('[ScopeFallback] embeddings denied for cloud; routing to Ollama');
                }
                else {
                    throw error;
                }
            }
        }
        candidates.push(new OllamaEmbeddingProvider_1.OllamaEmbeddingProvider(config.ollamaUrl || 'http://localhost:11434'));
        if (!embeddingsDenied) {
            candidates.push(new LocalEmbeddingProvider_1.LocalEmbeddingProvider()); // always last, always works
        }
        for (const provider of candidates) {
            const available = await EmbeddingProviderResolver.probeAvailable(provider);
            if (available) {
                console.log(`[EmbeddingProviderResolver] Selected provider: ${provider.name} (${provider.dimensions}d)`);
                return provider;
            }
            console.log(`[EmbeddingProviderResolver] Provider ${provider.name} unavailable, trying next...`);
        }
        if (embeddingsDenied) {
            console.warn('[ScopeFallback] embeddings denied; Ollama unavailable, using bundled local embedding model');
            return new LocalEmbeddingProvider_1.LocalEmbeddingProvider();
        }
        // This should never happen since LocalEmbeddingProvider.isAvailable()
        // only returns false if the bundled model is corrupted — a fatal install error
        throw new Error('No embedding provider available. The bundled model may be corrupted. Please reinstall.');
    }
}
exports.EmbeddingProviderResolver = EmbeddingProviderResolver;
//# sourceMappingURL=EmbeddingProviderResolver.js.map