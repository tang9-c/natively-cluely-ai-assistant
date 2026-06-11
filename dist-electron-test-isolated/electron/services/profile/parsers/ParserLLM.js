"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserLLM = void 0;
const PARSE_TIMEOUT_MS = 15_000;
function withTimeout(p, ms, label) {
    return Promise.race([
        p,
        new Promise((_, reject) => {
            const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            if (typeof t.unref === 'function') {
                t.unref();
            }
        }),
    ]);
}
function extractJsonObject(raw) {
    const cleaned = raw
        .replace(/```json/gi, '')
        .replace(/```/g, '')
        .trim();
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return cleaned.slice(firstBrace, lastBrace + 1);
    }
    return cleaned;
}
class ParserLLM {
    llmHelper;
    constructor(llmHelper) {
        this.llmHelper = llmHelper;
    }
    async parse(prompt, schemaDescription) {
        const systemHint = 'Respond with valid JSON and nothing else. Do not wrap the output in markdown code fences.';
        const fullPrompt = `${prompt}\n\n${schemaDescription}\n\n${systemHint}`;
        let lastError = null;
        for (let attempt = 0; attempt < 2; attempt++) {
            const promptForAttempt = attempt > 0
                ? `${fullPrompt}\n\nYour previous response was not valid JSON. Please return ONLY a JSON object.`
                : fullPrompt;
            try {
                const raw = await withTimeout(this.llmHelper.generateContentStructured(promptForAttempt), PARSE_TIMEOUT_MS, 'ParserLLM');
                const candidate = extractJsonObject(raw);
                const parsed = JSON.parse(candidate);
                return parsed;
            }
            catch (err) {
                lastError = err;
            }
        }
        throw lastError ?? new Error('Could not parse structured response from LLM');
    }
}
exports.ParserLLM = ParserLLM;
//# sourceMappingURL=ParserLLM.js.map