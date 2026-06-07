"use strict";
/**
 * ModelVersionManager — Static fallback chain constants.
 *
 * Replaces the previous 1,200-line auto-discovery + 3-tier promotion system.
 * All tiers now return the same hardcoded stable model IDs. If a model is
 * deprecated, update this file directly.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ModelVersionManager = exports.TEXT_FALLBACK_CHAIN = exports.VISION_FALLBACK_CHAIN = exports.TEXT_PROVIDER_ORDER = exports.VISION_PROVIDER_ORDER = exports.TextModelFamily = exports.ModelFamily = void 0;
var ModelFamily;
(function (ModelFamily) {
    ModelFamily["OPENAI"] = "openai";
    ModelFamily["GEMINI_FLASH"] = "gemini_flash";
    ModelFamily["GEMINI_PRO"] = "gemini_pro";
    ModelFamily["CLAUDE"] = "claude";
    ModelFamily["GROQ_LLAMA"] = "groq_llama";
})(ModelFamily || (exports.ModelFamily = ModelFamily = {}));
var TextModelFamily;
(function (TextModelFamily) {
    TextModelFamily["OPENAI"] = "text_openai";
    TextModelFamily["GEMINI_FLASH"] = "text_gemini_flash";
    TextModelFamily["GEMINI_PRO"] = "text_gemini_pro";
    TextModelFamily["CLAUDE"] = "text_claude";
    TextModelFamily["GROQ"] = "text_groq";
})(TextModelFamily || (exports.TextModelFamily = TextModelFamily = {}));
/** Vision-capable model ordering for screenshot analysis */
exports.VISION_PROVIDER_ORDER = [
    ModelFamily.OPENAI,
    ModelFamily.GEMINI_FLASH,
    ModelFamily.CLAUDE,
    ModelFamily.GEMINI_PRO,
    ModelFamily.GROQ_LLAMA,
];
/** Text model ordering for chat fallback chains */
exports.TEXT_PROVIDER_ORDER = [
    TextModelFamily.GROQ,
    TextModelFamily.OPENAI,
    TextModelFamily.CLAUDE,
    TextModelFamily.GEMINI_FLASH,
    TextModelFamily.GEMINI_PRO,
];
/** Static vision fallback chain: all tiers use the same stable model */
exports.VISION_FALLBACK_CHAIN = {
    [ModelFamily.OPENAI]: ['gpt-4.1', 'gpt-4.1', 'gpt-4.1'],
    [ModelFamily.GEMINI_FLASH]: ['gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20'],
    [ModelFamily.GEMINI_PRO]: ['gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05'],
    [ModelFamily.CLAUDE]: ['claude-sonnet-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-5'],
    [ModelFamily.GROQ_LLAMA]: ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'],
};
/** Static text fallback chain: all tiers use the same stable model */
exports.TEXT_FALLBACK_CHAIN = {
    [TextModelFamily.OPENAI]: ['gpt-4.1', 'gpt-4.1', 'gpt-4.1'],
    [TextModelFamily.GEMINI_FLASH]: ['gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20'],
    [TextModelFamily.GEMINI_PRO]: ['gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05'],
    [TextModelFamily.CLAUDE]: ['claude-sonnet-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-5'],
    [TextModelFamily.GROQ]: ['llama-3.3-70b-versatile', 'llama-3.3-70b-versatile', 'llama-3.3-70b-versatile'],
};
/** No-op stub that preserves the old class interface for minimal churn.
 *  All methods return the static chains above. */
class ModelVersionManager {
    setApiKeys(_keys) { }
    async initialize() { }
    stopScheduler() { }
    getTieredModels(family) {
        const [tier1, tier2, tier3] = exports.VISION_FALLBACK_CHAIN[family] ?? ['', '', ''];
        return { tier1, tier2, tier3 };
    }
    getAllVisionTiers() {
        return exports.VISION_PROVIDER_ORDER.map(family => ({
            family,
            ...this.getTieredModels(family),
        }));
    }
    getTextTieredModels(family) {
        const [tier1, tier2, tier3] = exports.TEXT_FALLBACK_CHAIN[family] ?? ['', '', ''];
        return { tier1, tier2, tier3 };
    }
    getAllTextTiers() {
        return exports.TEXT_PROVIDER_ORDER.map(family => ({
            family,
            ...this.getTextTieredModels(family),
        }));
    }
    async onModelError(_failedModelId) { }
    rollback(_family) { return false; }
    getSummary() {
        const lines = ['[ModelVersionManager] Static fallback chains:'];
        lines.push('  --- Vision ---');
        for (const family of exports.VISION_PROVIDER_ORDER) {
            const t = this.getTieredModels(family);
            lines.push(`  ${family}: T1=${t.tier1} | T2/T3=${t.tier2}`);
        }
        lines.push('  --- Text ---');
        for (const family of exports.TEXT_PROVIDER_ORDER) {
            const t = this.getTextTieredModels(family);
            lines.push(`  ${family}: T1=${t.tier1} | T2/T3=${t.tier2}`);
        }
        return lines.join('\n');
    }
}
exports.ModelVersionManager = ModelVersionManager;
//# sourceMappingURL=ModelVersionManager.js.map