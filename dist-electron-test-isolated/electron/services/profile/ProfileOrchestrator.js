"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileOrchestrator = void 0;
const fs_1 = __importDefault(require("fs"));
const os_1 = __importDefault(require("os"));
const path_1 = __importDefault(require("path"));
const ProfileDatabase_1 = require("./ProfileDatabase");
const DocumentTextExtractor_1 = require("./DocumentTextExtractor");
const ParserLLM_1 = require("./parsers/ParserLLM");
const ResumeParser_1 = require("./parsers/ResumeParser");
const JDParser_1 = require("./parsers/JDParser");
const redactForLog_1 = require("../../utils/redactForLog");
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
class ProfileOrchestrator {
    db = new ProfileDatabase_1.ProfileDatabase();
    resumeParser = null;
    jdParser = null;
    activeMode = false;
    customNotes = '';
    setLLMHelper(llmHelper) {
        const parserLLM = new ParserLLM_1.ParserLLM(llmHelper);
        this.resumeParser = new ResumeParser_1.ResumeParser(parserLLM);
        this.jdParser = new JDParser_1.JDParser(parserLLM);
    }
    async ingestDocument(filePath, docType) {
        try {
            const rawText = await DocumentTextExtractor_1.DocumentTextExtractor.extract(filePath);
            if (!rawText || rawText.trim().length === 0) {
                return { success: false, error: 'File appears to be empty' };
            }
            const uploadsDir = this.getUploadsDir();
            if (!fs_1.default.existsSync(uploadsDir)) {
                fs_1.default.mkdirSync(uploadsDir, { recursive: true });
            }
            const ext = path_1.default.extname(filePath);
            const prefix = docType === 'resume' ? 'resume' : 'jd';
            const destPath = path_1.default.join(uploadsDir, `${prefix}-${Date.now()}${ext}`);
            fs_1.default.copyFileSync(filePath, destPath);
            if (docType === 'resume') {
                if (!this.resumeParser) {
                    return { success: false, error: 'Knowledge engine not initialized' };
                }
                const parsed = await withTimeout(this.resumeParser.parse(rawText), 60_000, 'Resume parse');
                this.db.saveResume(parsed);
                this.db.saveResumeNodes(this.buildResumeNodes(parsed));
            }
            else if (docType === 'job_description') {
                if (!this.jdParser) {
                    return { success: false, error: 'Knowledge engine not initialized' };
                }
                const parsed = await withTimeout(this.jdParser.parse(rawText), 60_000, 'JD parse');
                this.db.saveJD(rawText, parsed);
            }
            return { success: true };
        }
        catch (error) {
            console.error('[ProfileOrchestrator] ingestDocument error:', (0, redactForLog_1.redactForLog)([error]));
            const message = error?.message ?? '';
            if (message.includes('empty')) {
                return { success: false, error: message };
            }
            if (message.includes('timed out')) {
                return { success: false, error: 'Document parsing timed out. Please try again.' };
            }
            return {
                success: false,
                error: 'Could not parse document. Please try a simpler format.',
            };
        }
    }
    getStatus() {
        const profile = this.db.getUserProfile();
        const hasResume = !!profile;
        if (!hasResume) {
            return { hasResume: false, activeMode: this.activeMode };
        }
        let parsed;
        try {
            parsed = JSON.parse(profile.structured_json);
        }
        catch {
            return { hasResume: false, activeMode: this.activeMode };
        }
        return {
            hasResume: true,
            activeMode: this.activeMode,
            resumeSummary: {
                name: parsed.identity?.name,
                role: parsed.experience?.[0]?.title,
                totalExperienceYears: this.computeExperienceYears(parsed.experience),
            },
        };
    }
    setKnowledgeMode(enabled) {
        this.activeMode = enabled;
    }
    deleteDocumentsByType(docType) {
        if (docType === 'resume') {
            this.db.clearResume();
        }
        else if (docType === 'job_description') {
            this.db.clearJD();
        }
    }
    getProfileData() {
        const profile = this.db.getUserProfile();
        if (!profile)
            return null;
        let parsed;
        try {
            parsed = JSON.parse(profile.structured_json);
        }
        catch {
            return null;
        }
        const activeJD = this.db.getActiveJD();
        const hasActiveJD = !!activeJD;
        return {
            identity: {
                name: parsed.identity?.name ?? 'Unknown',
                email: parsed.identity?.email,
            },
            experienceCount: parsed.experience?.length ?? 0,
            projectCount: parsed.projects?.length ?? 0,
            nodeCount: (parsed.experience?.length ?? 0) +
                (parsed.projects?.length ?? 0) +
                (parsed.education?.length ?? 0),
            skills: parsed.skills ?? [],
            hasActiveJD,
            activeJD: hasActiveJD ? activeJD : undefined,
        };
    }
    getCompanyResearchEngine() {
        return null;
    }
    getNegotiationTracker() {
        return null;
    }
    getNegotiationScript() {
        return null;
    }
    async generateNegotiationScriptOnDemand() {
        return null;
    }
    resetNegotiationSession() { }
    setCustomNotes(content) {
        this.customNotes = typeof content === 'string' ? content : '';
    }
    getCustomNotes() {
        return this.customNotes;
    }
    getUploadsDir() {
        try {
            const { app } = require('electron');
            return path_1.default.join(app.getPath('userData'), 'profile-uploads');
        }
        catch {
            return path_1.default.join(os_1.default.tmpdir(), 'profile-uploads');
        }
    }
    buildResumeNodes(parsed) {
        const nodes = [];
        for (const exp of parsed.experience ?? []) {
            nodes.push({
                category: 'experience',
                title: exp.title,
                organization: exp.organization,
                startDate: exp.start,
                endDate: exp.end,
                textContent: exp.description,
            });
        }
        for (const proj of parsed.projects ?? []) {
            nodes.push({
                category: 'project',
                title: proj.name,
                textContent: proj.description,
            });
        }
        for (const edu of parsed.education ?? []) {
            nodes.push({
                category: 'education',
                title: edu.degree,
                organization: edu.institution,
                textContent: edu.year,
            });
        }
        return nodes;
    }
    computeExperienceYears(experience) {
        if (!experience || experience.length === 0)
            return undefined;
        const now = new Date().getFullYear();
        let totalYears = 0;
        for (const exp of experience) {
            const startMatch = exp.start?.match(/(\d{4})/);
            if (!startMatch)
                continue;
            const startYear = parseInt(startMatch[1], 10);
            let endYear = now;
            if (exp.end && !/present|now|current/i.test(exp.end)) {
                const endMatch = exp.end.match(/(\d{4})/);
                if (endMatch)
                    endYear = parseInt(endMatch[1], 10);
            }
            if (!Number.isNaN(startYear) && !Number.isNaN(endYear) && endYear >= startYear) {
                totalYears += endYear - startYear;
            }
        }
        return totalYears > 0 ? totalYears : undefined;
    }
}
exports.ProfileOrchestrator = ProfileOrchestrator;
//# sourceMappingURL=ProfileOrchestrator.js.map