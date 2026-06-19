import { DatabaseManager } from '../../db/DatabaseManager';
import type { JDParsed, ResumeNode, ResumeParsed, UserProfileRecord } from './types';

export class ProfileDatabase {
  private db: DatabaseManager;

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  getUserProfile(): UserProfileRecord | null {
    return this.db.getUserProfile();
  }

  saveResume(resume: ResumeParsed): void {
    this.db.saveUserProfile(JSON.stringify(resume));
  }

  clearResume(): void {
    this.db.clearUserProfile();
    this.db.clearResumeNodes();
  }

  saveResumeNodes(nodes: ResumeNode[]): void {
    this.db.clearResumeNodes();
    this.db.upsertResumeNodes(nodes);
  }

  getResumeNodes(category?: string): ResumeNode[] {
    return this.db.getResumeNodes(category) as ResumeNode[];
  }

  getActiveJD(): JDParsed | null {
    const row = this.db.getActiveJD();
    if (!row) return null;
    try {
      return JSON.parse(row.parsed_json) as JDParsed;
    } catch {
      return null;
    }
  }

  saveJD(rawText: string, parsed: JDParsed, fileHash?: string): void {
    this.db.saveActiveJD(rawText, JSON.stringify(parsed), fileHash);
  }

  clearJD(): void {
    this.db.clearActiveJD();
  }

  upsertModeReferenceFileMetadata(input: {
    referenceFileId: string;
    scenarioType: string;
    docSubtype: string;
    parsedJson?: string | null;
    fileHash?: string | null;
  }): void {
    this.db.upsertModeReferenceFileMetadata(input);
  }

  getModeReferenceFileMetadata(referenceFileId: string): any | null {
    return this.db.getModeReferenceFileMetadata(referenceFileId);
  }

  getModeReferenceFileMetadataForMode(modeId: string): any[] {
    return this.db.getModeReferenceFileMetadataForMode(modeId);
  }
}
