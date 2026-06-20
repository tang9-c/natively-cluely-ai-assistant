import { DatabaseManager } from '../../db/DatabaseManager';
import type { JDParsed, ResumeNode, ResumeParsed, UserProfileRecord } from './types';

export class ProfileDatabase {
  private db: DatabaseManager;

  constructor() {
    this.db = DatabaseManager.getInstance();
  }

  /**
   * Expose the raw better-sqlite3 connection for consumers that need
   * direct SQL access (e.g. CompanyResearchCache). Returns null when
   * the database failed to initialize so callers can fail explicitly.
   */
  getRawDb(): import('better-sqlite3').Database | null {
    return this.db.getDb();
  }

  getUserProfile(): UserProfileRecord | null {
    // Legacy facade — returns null now that user_profile has been dropped.
    // ProfileOrchestrator no longer relies on this; it uses getMasterAsResume().
    return this.db.getUserProfile();
  }

  saveResume(resume: ResumeParsed): void {
    // Legacy facade retained for callers that haven't migrated to saveResumeToMaster.
    // ProfileOrchestrator should call saveResumeToMaster() directly.
    this.saveResumeToMaster(resume);
  }

  clearResume(): void {
    // Legacy facade. Profile master now stores all profile data.
    this.clearMasterResume();
  }

  /**
   * Task 4: Atomically translate a ResumeParsed into the profile_master
   * columns and persist it. Wrapped in a better-sqlite3 transaction so a
   * failure mid-write leaves the master row untouched.
   */
  saveResumeToMaster(resume: ResumeParsed): void {
    const persist = this.db.transaction(() => {
      // headline = most-recent job title. ResumeIdentity has no role field;
      // "current role" is the first entry of experience[] (the orchestrator
      // surface in getStatus reads it the same way).
      const headline = resume.experience?.[0]?.title ?? null;
      this.db.updateProfileMaster({
        displayName: resume.identity?.name ?? null,
        headline,
        summary: resume.summary ?? '',
        contactInfoJson: JSON.stringify({
          email: resume.identity?.email,
          phone: resume.identity?.phone,
          location: resume.identity?.location,
          linkedin: resume.identity?.linkedin,
        }),
        experienceJson: JSON.stringify(resume.experience ?? []),
        skillsJson: JSON.stringify(resume.skills ?? []),
      });
    });
    persist();
  }

  /**
   * Task 4: Read profile_master and synthesize a ResumeParsed shape so
   * ProfileOrchestrator.getStatus/getProfileData can stay ResumeParsed-shaped
   * while reading from the new master table.
   */
  getMasterAsResume(): ResumeParsed | null {
    const master = this.db.getProfileMaster();
    if (!master) return null;

    const displayName = (master.display_name ?? '').toString().trim();
    const headline = (master.headline ?? '').toString().trim();
    const summary = (master.summary ?? '').toString().trim();

    const experience = safeJsonArray(master.experience_json);
    const skills = safeJsonArray(master.skills_json);
    const contact = safeJsonObject(master.contact_info_json);

    // If everything is empty, treat as "no resume" so UI shows zero state.
    // Also treat placeholder names like "Unknown" as empty so they don't leak
    // into the UI when parsing failed silently.
    const isRealName = displayName.length > 0 && displayName.toLowerCase() !== 'unknown';
    const hasContent =
      isRealName ||
      headline.length > 0 ||
      summary.length > 0 ||
      experience.length > 0 ||
      skills.length > 0;
    if (!hasContent) return null;

    return {
      identity: {
        name: isRealName ? displayName : 'Unknown',
        email: contact.email,
        phone: contact.phone,
        location: contact.location,
        linkedin: contact.linkedin,
      },
      summary: summary || undefined,
      skills: skills,
      experience: experience,
      projects: [],
      education: [],
    };
  }

  /**
   * Task 4: Clear profile_master resume fields. Used by deleteDocumentsByType.
   */
  clearMasterResume(): void {
    this.db.updateProfileMaster({
      displayName: null,
      headline: null,
      summary: '',
      contactInfoJson: '{}',
      experienceJson: '[]',
      skillsJson: '[]',
    });
  }

  // ----------------------------------------------------------------------
  // Legacy facade for resume_nodes (no-op now that the table is dropped).
  // Kept so any external callers (or future code) do not crash. The methods
  // intentionally do nothing — they are scheduled for full removal once all
  // callers are migrated.
  // ----------------------------------------------------------------------

  saveResumeNodes(_nodes: ResumeNode[]): void {
    // no-op: resume_nodes table dropped in v19
  }

  getResumeNodes(_category?: string): ResumeNode[] {
    return [];
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

function safeJsonArray(value: string | null | undefined): any[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value: string | null | undefined): Record<string, any> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
