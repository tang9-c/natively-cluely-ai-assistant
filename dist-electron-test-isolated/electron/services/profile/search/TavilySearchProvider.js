"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TavilySearchProvider = void 0;
class TavilySearchProvider {
    quotaExhausted = false;
    apiKey;
    constructor(apiKey) {
        this.apiKey = apiKey;
    }
    async search(_query, _options) {
        // MVP placeholder — company research is out of scope.
        return { results: [] };
    }
}
exports.TavilySearchProvider = TavilySearchProvider;
//# sourceMappingURL=TavilySearchProvider.js.map