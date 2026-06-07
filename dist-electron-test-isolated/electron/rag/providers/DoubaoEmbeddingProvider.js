"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoubaoEmbeddingProvider = void 0;
const embeddingSpace_1 = require("../embeddingSpace");
class DoubaoEmbeddingProvider {
    apiKey;
    mrlDim;
    name = 'doubao';
    model;
    space;
    dimensions; // Dynamically detected from actual API response
    baseUrl = 'https://ark.cn-beijing.volces.com/api/v3';
    constructor(apiKey, 
    // Doubao Ark API: model should be an endpoint ID (e.g., ep-20260321165850-k9w7r), not a model name
    // If not provided, embedding will likely fail - user must configure a valid endpoint ID
    model, mrlDim // Optional MRL dimension: 2048, 1024, 512, 256
    ) {
        this.apiKey = apiKey;
        this.mrlDim = mrlDim;
        // Start with a safe default; actual dimensions are detected at runtime via isAvailable()
        this.dimensions = this.mrlDim || 4096;
        this.model = model || 'unknown';
        this.space = (0, embeddingSpace_1.embeddingSpaceKey)({ name: this.name, model: this.model, dimensions: this.dimensions });
        // Log the configured model/endpoint ID for debugging
        console.log(`[DoubaoEmbedding] Configured model/endpoint: ${this.model || '(none - will likely fail)'}`);
    }
    async isAvailable() {
        // Fast check — do a single test embed and detect dimensions from the response
        try {
            const emb = await this.embed('test');
            this.dimensions = emb.length;
            console.log(`[DoubaoEmbedding] Detected dimensions: ${this.dimensions}`);
            return true;
        }
        catch (e) {
            console.warn('[DoubaoEmbedding] Availability check failed:', e);
            return false;
        }
    }
    async embed(text) {
        // Try standard embeddings endpoint first, then multimodal if it fails with 404/400
        try {
            return await this._embedWithEndpoint(`${this.baseUrl}/embeddings`, text);
        }
        catch (error) {
            if (error.message?.includes('404') || error.message?.includes('NotFound')
                || error.message?.includes('400') || error.message?.includes('Bad Request')) {
                console.log('[DoubaoEmbedding] Standard endpoint failed, trying multimodal endpoint...');
                return await this._embedWithEndpoint(`${this.baseUrl}/embeddings/multimodal`, text);
            }
            throw error;
        }
    }
    async _embedWithEndpoint(endpoint, text) {
        const isMultimodal = endpoint.includes('/multimodal');
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                input: isMultimodal
                    ? [{ type: 'text', text: text }]
                    : text,
                encoding_format: 'float'
            })
        });
        if (!res.ok) {
            const errorText = await res.text().catch(() => res.statusText);
            throw new Error(`Doubao embedding failed: ${res.status} ${errorText}`);
        }
        const data = await res.json();
        // Multimodal endpoint returns { data: { embedding: [...] } }
        // Standard endpoint returns { data: [{ embedding: [...] }] }
        let embedding = data.data?.[0]?.embedding ?? data.data?.embedding;
        // Apply MRL truncation if specified
        if (this.mrlDim !== undefined && this.mrlDim < embedding.length) {
            embedding = embedding.slice(0, this.mrlDim);
        }
        // Normalize to compute cosine similarity
        return this.normalize(embedding);
    }
    async embedQuery(text) {
        // Doubao embedding model is symmetric by default
        // For optimal search performance, prepend instruction (as shown in example)
        const queryText = `Instruct: Given a web search query, retrieve relevant passages that answer the query\nQuery: ${text}`;
        return this.embed(queryText);
    }
    async embedBatch(texts) {
        // Try standard embeddings endpoint first (supports true batching)
        try {
            return await this._embedBatchWithEndpoint(`${this.baseUrl}/embeddings`, texts);
        }
        catch (error) {
            if (error.message?.includes('404') || error.message?.includes('NotFound')
                || error.message?.includes('400') || error.message?.includes('Bad Request')) {
                console.log('[DoubaoEmbedding] Standard batch endpoint failed, falling back to parallel multimodal single requests...');
                // Multimodal endpoint doesn't support true batching — send parallel single requests
                return Promise.all(texts.map(text => this._embedWithEndpoint(`${this.baseUrl}/embeddings/multimodal`, text)));
            }
            throw error;
        }
    }
    async _embedBatchWithEndpoint(endpoint, texts) {
        const isMultimodal = endpoint.includes('/multimodal');
        const res = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.apiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: this.model,
                input: isMultimodal
                    ? texts.map(text => ({ type: 'text', text: text }))
                    : texts,
                encoding_format: 'float'
            })
        });
        if (!res.ok) {
            const errorText = await res.text().catch(() => res.statusText);
            throw new Error(`Doubao batch embedding failed: ${res.status} ${errorText}`);
        }
        const data = await res.json();
        // Multimodal endpoint may return { data: { embedding: [...] } } for single or { data: [{ embedding: [...] }] } for batch
        let embeddings;
        if (Array.isArray(data.data)) {
            embeddings = data.data.map((d) => d.embedding);
        }
        else if (data.data?.embedding) {
            embeddings = [data.data.embedding];
        }
        else {
            embeddings = [];
        }
        // Apply MRL truncation if specified
        if (this.mrlDim !== undefined) {
            embeddings = embeddings.map(emb => emb.slice(0, this.mrlDim));
        }
        // Normalize all embeddings
        return embeddings.map(emb => this.normalize(emb));
    }
    /**
     * Normalize vector to unit length for cosine similarity computation
     */
    normalize(vector) {
        const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
        if (magnitude === 0)
            return vector;
        return vector.map(val => val / magnitude);
    }
}
exports.DoubaoEmbeddingProvider = DoubaoEmbeddingProvider;
//# sourceMappingURL=DoubaoEmbeddingProvider.js.map