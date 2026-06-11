"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NativelySearchProvider = void 0;
class NativelySearchProvider {
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
exports.NativelySearchProvider = NativelySearchProvider;
//# sourceMappingURL=NativelySearchProvider.js.map