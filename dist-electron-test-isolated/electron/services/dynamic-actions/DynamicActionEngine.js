"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.DynamicActionEngine = void 0;
const crypto = __importStar(require("crypto"));
const DynamicActionStore_1 = require("./DynamicActionStore");
const DynamicActionDetector_1 = require("./DynamicActionDetector");
class DynamicActionEngine {
    store;
    detector;
    constructor(store = new DynamicActionStore_1.DynamicActionStore(), detector = new DynamicActionDetector_1.DynamicActionDetector(DynamicActionDetector_1.MODE_TRIGGERS)) {
        this.store = store;
        this.detector = detector;
    }
    detectActions(params) {
        const { transcript, speaker, modeTemplateType, modeId, sessionId } = params;
        const now = Date.now();
        const candidateActions = [];
        // Detect triggers using regex patterns
        const matchedTriggers = this.detector.detectTriggers({ transcript, modeTemplateType });
        for (const { trigger, match, index } of matchedTriggers) {
            // Build evidence ref from transcript
            const evidenceRef = {
                source: 'transcript',
                text: transcript,
                timestamp: now,
                speaker,
            };
            // Create candidate action. Loop runs once per matched trigger
            // within a single detectActions() call, so `now` is identical for
            // every action minted here — embedding it in the id is not
            // sufficient on its own. Use a UUID for the id; `now` stays as
            // createdAt (where the shared timestamp is the correct semantic).
            const action = {
                id: `action_${crypto.randomUUID()}`,
                sessionId,
                modeId,
                modeTemplateType,
                type: trigger.type,
                label: trigger.label,
                description: `Triggered by: "${match}"`,
                confidence: trigger.priority,
                priority: trigger.priority,
                evidenceRefs: [evidenceRef],
                status: 'candidate',
                createdAt: now,
                promptInstruction: trigger.promptInstruction,
                answerStyle: trigger.answerStyle,
            };
            // Check deduplication
            const deduplicatedAction = this.store.deduplicate(action);
            if (deduplicatedAction) {
                candidateActions.push(deduplicatedAction);
                this.store.addAction(deduplicatedAction);
            }
        }
        return candidateActions;
    }
    getTopActions(sessionId, maxAgeMs = 60000) {
        // Expire stale actions first
        this.store.expireStaleActions(sessionId, maxAgeMs);
        // Get active actions sorted by priority (descending)
        const activeActions = this.store.getActiveActions(sessionId);
        return activeActions
            .sort((a, b) => b.priority - a.priority)
            .slice(0, 3);
    }
    acceptAction(actionId) {
        const action = this.store.getAction(actionId);
        if (action) {
            this.store.updateStatus(actionId, 'accepted');
            return action;
        }
        return null;
    }
    dismissAction(actionId) {
        this.store.updateStatus(actionId, 'dismissed');
    }
    completeAction(actionId) {
        this.store.updateStatus(actionId, 'completed');
    }
    getStore() {
        return this.store;
    }
    getDetector() {
        return this.detector;
    }
}
exports.DynamicActionEngine = DynamicActionEngine;
//# sourceMappingURL=DynamicActionEngine.js.map