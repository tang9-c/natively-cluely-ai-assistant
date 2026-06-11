"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfileDatabase = void 0;
const DatabaseManager_1 = require("../../db/DatabaseManager");
class ProfileDatabase {
    db;
    constructor() {
        this.db = DatabaseManager_1.DatabaseManager.getInstance();
    }
    getUserProfile() {
        return this.db.getUserProfile();
    }
    saveResume(resume) {
        this.db.saveUserProfile(JSON.stringify(resume));
    }
    clearResume() {
        this.db.clearUserProfile();
        this.db.clearResumeNodes();
    }
    saveResumeNodes(nodes) {
        this.db.clearResumeNodes();
        this.db.upsertResumeNodes(nodes);
    }
    getResumeNodes(category) {
        return this.db.getResumeNodes(category);
    }
    getActiveJD() {
        const row = this.db.getActiveJD();
        if (!row)
            return null;
        try {
            return JSON.parse(row.parsed_json);
        }
        catch {
            return null;
        }
    }
    saveJD(rawText, parsed, fileHash) {
        this.db.saveActiveJD(rawText, JSON.stringify(parsed), fileHash);
    }
    clearJD() {
        this.db.clearActiveJD();
    }
}
exports.ProfileDatabase = ProfileDatabase;
//# sourceMappingURL=ProfileDatabase.js.map