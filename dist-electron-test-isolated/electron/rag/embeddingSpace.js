"use strict";
// electron/rag/embeddingSpace.ts
// Single source of truth for an embedding "space" identity.
//
// An embedding space is the (provider family, model, dimensions) tuple that a
// vector was produced in. Two vectors are only comparable if they share a space.
//
// The historical bug this fixes: re-index compatibility used to key on the
// provider NAME alone ('gemini'). That cannot distinguish gemini-embedding-001
// (768d) from gemini-embedding-2 (768d) — same name, same dims, but INCOMPATIBLE
// vector spaces. Comparing them yields semantically random cosine similarity with
// no error. Keying on the composite space string fixes this and generalizes to
// any provider/model/dimension change.
Object.defineProperty(exports, "__esModule", { value: true });
exports.LEGACY_PROVIDER_MODEL = void 0;
exports.normalizeModel = normalizeModel;
exports.embeddingSpaceKey = embeddingSpaceKey;
exports.buildLegacySpaceCaseSql = buildLegacySpaceCaseSql;
exports.legacySpaceForProvider = legacySpaceForProvider;
/** Strip the optional `models/` prefix and normalize casing/whitespace so
 *  'models/gemini-embedding-001' and 'gemini-embedding-001' collapse to one key. */
function normalizeModel(model) {
    return model.replace(/^models\//, '').trim().toLowerCase();
}
/**
 * Canonical identity for an embedding space: `${name}:${normalizeModel(model)}:${dims}`.
 *
 * INVARIANT: this is an OPAQUE EQUALITY KEY. Never parse it by splitting on ':' —
 * a model id may itself contain a colon (e.g. Ollama's `nomic-embed-text:latest`),
 * which would make a split ambiguous. All consumers (VectorStore predicates, the
 * search worker, the DB backfill CASE) compare it by equality only.
 */
function embeddingSpaceKey(p) {
    return `${p.name}:${normalizeModel(p.model)}:${p.dimensions}`;
}
/**
 * The model id each provider shipped with at the time legacy (pre-embedding_space)
 * rows were written. Single source of truth shared by legacySpaceForProvider() and
 * the v16 DB migration's backfill CASE (DatabaseManager builds the CASE arms by
 * iterating this map — see the v16 block in DatabaseManager.runMigrations).
 * Values are already normalized (lowercase, no `models/` prefix).
 */
exports.LEGACY_PROVIDER_MODEL = {
    gemini: 'gemini-embedding-001',
    ollama: 'nomic-embed-text',
    openai: 'text-embedding-3-small',
    local: 'xenova/paraphrase-multilingual-minilm-l12-v2',
};
/**
 * Build the SQL `CASE embedding_provider WHEN ... THEN ... END` arms for the v16
 * migration backfill, derived from LEGACY_PROVIDER_MODEL so the migration and the
 * runtime key share ONE source of truth (can't drift). Returns just the WHEN/THEN
 * lines (no CASE/END wrapper) for interpolation into the backfill UPDATE.
 *
 * Values come from a hardcoded internal map (never user input) so direct string
 * interpolation is safe here; there is no SQL-injection surface.
 */
function buildLegacySpaceCaseSql() {
    return Object.entries(exports.LEGACY_PROVIDER_MODEL)
        .map(([provider, model]) => `WHEN '${provider}' THEN '${model}'`)
        .join('\n                          ');
}
/**
 * Synthesize the v1 (pre-migration) space for a legacy row that only has an
 * `embedding_provider` name (+ maybe dims). Used by the schema backfill so that
 * old rows carry a concrete space string which correctly DIFFERS from any new
 * model's space, triggering re-index.
 *
 * Must stay in sync with the model defaults the providers shipped with at the
 * time the legacy rows were written.
 */
function legacySpaceForProvider(name, dims) {
    const model = exports.LEGACY_PROVIDER_MODEL[name] ?? 'unknown';
    return `${name}:${model}:${dims ?? 'unknown'}`;
}
//# sourceMappingURL=embeddingSpace.js.map