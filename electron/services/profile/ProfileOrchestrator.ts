import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DocType, JDParsed, ProfileData, ResumeNode, ResumeParsed } from './types';
import { ProfileDatabase } from './ProfileDatabase';
import { DocumentTextExtractor } from './DocumentTextExtractor';
import { ParserLLM } from './parsers/ParserLLM';
import { ResumeParser } from './parsers/ResumeParser';
import { JDParser } from './parsers/JDParser';
import { redactForLog } from '../../utils/redactForLog';
import type {
  EmbedFn,
  GenerateContentFn,
  KnowledgeResult,
  ProfileOrchestratorRuntime,
} from './ProfileOrchestratorContract';

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (typeof (t as any).unref === 'function') {
        (t as any).unref();
      }
    }),
  ]);
}

export class ProfileOrchestrator implements ProfileOrchestratorRuntime {
  private db = new ProfileDatabase();
  private resumeParser: ResumeParser | null = null;
  private jdParser: JDParser | null = null;
  private activeMode = false;
  private customNotes = '';
  private generateContentFn: GenerateContentFn | null = null;
  private liveCoachingContentFn: GenerateContentFn | null = null;
  private embedFn: EmbedFn | null = null;
  private embedQueryFn: EmbedFn | null = null;

  setLLMHelper(llmHelper: any): void {
    const parserLLM = new ParserLLM(llmHelper);
    this.resumeParser = new ResumeParser(parserLLM);
    this.jdParser = new JDParser(parserLLM);
  }

  async ingestDocument(
    filePath: string,
    docType: DocType,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const rawText = await DocumentTextExtractor.extract(filePath);
      if (!rawText || rawText.trim().length === 0) {
        return { success: false, error: 'File appears to be empty' };
      }

      const uploadsDir = this.getUploadsDir();
      if (!fs.existsSync(uploadsDir)) {
        fs.mkdirSync(uploadsDir, { recursive: true });
      }
      const ext = path.extname(filePath);
      const prefix = docType === 'resume' ? 'resume' : 'jd';
      const destPath = path.join(uploadsDir, `${prefix}-${Date.now()}${ext}`);
      fs.copyFileSync(filePath, destPath);

      if (docType === 'resume') {
        if (!this.resumeParser) {
          return { success: false, error: 'Knowledge engine not initialized' };
        }
        const parsed = await withTimeout(
          this.resumeParser.parse(rawText),
          60_000,
          'Resume parse',
        );
        this.db.saveResume(parsed);
        this.db.saveResumeNodes(this.buildResumeNodes(parsed));
      } else if (docType === 'job_description') {
        if (!this.jdParser) {
          return { success: false, error: 'Knowledge engine not initialized' };
        }
        const parsed = await withTimeout(
          this.jdParser.parse(rawText),
          60_000,
          'JD parse',
        );
        this.db.saveJD(rawText, parsed);
      }

      return { success: true };
    } catch (error: any) {
      console.error(
        '[ProfileOrchestrator] ingestDocument error:',
        redactForLog([error]),
      );
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

  getStatus(): {
    hasResume: boolean;
    activeMode: boolean;
    resumeSummary?: { name?: string; role?: string; totalExperienceYears?: number };
  } {
    const profile = this.db.getUserProfile();
    const hasResume = !!profile;
    if (!hasResume) {
      return { hasResume: false, activeMode: this.activeMode };
    }

    let parsed: ResumeParsed;
    try {
      parsed = JSON.parse(profile.structured_json) as ResumeParsed;
    } catch {
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

  setKnowledgeMode(enabled: boolean): void {
    this.activeMode = enabled;
  }

  isKnowledgeMode(): boolean {
    return this.activeMode;
  }

  feedForDepthScoring(_message: string): void {
    // Reserved for the restored knowledge-depth scorer. Kept as a no-op so
    // LLMHelper can call the runtime contract without optional chaining drift.
  }

  feedInterviewerUtterance(_message: string): void {
    // Reserved for live coaching/negotiation state. Scenario-aware injection is
    // request-scoped for now, so no transcript state is accumulated here.
  }

  setGenerateContentFn(fn: GenerateContentFn): void {
    this.generateContentFn = fn;
  }

  setLiveCoachingContentFn(fn: GenerateContentFn): void {
    this.liveCoachingContentFn = fn;
  }

  setEmbedFn(fn: EmbedFn): void {
    this.embedFn = fn;
  }

  setEmbedQueryFn(fn: EmbedFn): void {
    this.embedQueryFn = fn;
  }

  async processQuestion(message: string): Promise<KnowledgeResult | null> {
    if (!this.activeMode) return null;
    try {
      const { ScenarioContextService } = require('./ScenarioContextService');
      const service = new ScenarioContextService();
      const result = await service.buildForRequest({
        query: message,
        includeSystemPrompt: true,
      });
      if (!result?.contextBlock && !result?.systemPromptSuffix) return null;
      return {
        systemPromptInjection: result.systemPromptSuffix,
        contextBlock: result.contextBlock,
        dataScopes: result.dataScopes,
      };
    } catch (error: any) {
      if (error?.code !== 'MODULE_NOT_FOUND') {
        console.warn('[ProfileOrchestrator] processQuestion failed:', redactForLog([error]));
      }
      return null;
    }
  }

  deleteDocumentsByType(docType: DocType): void {
    if (docType === 'resume') {
      this.db.clearResume();
    } else if (docType === 'job_description') {
      this.db.clearJD();
    }
  }

  getProfileData(): ProfileData | null {
    const profile = this.db.getUserProfile();
    if (!profile) return null;

    let parsed: ResumeParsed;
    try {
      parsed = JSON.parse(profile.structured_json) as ResumeParsed;
    } catch {
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
      nodeCount:
        (parsed.experience?.length ?? 0) +
        (parsed.projects?.length ?? 0) +
        (parsed.education?.length ?? 0),
      skills: parsed.skills ?? [],
      hasActiveJD,
      activeJD: hasActiveJD ? activeJD : undefined,
    };
  }

  setCustomNotes(content: string): void {
    this.customNotes = typeof content === 'string' ? content : '';
  }

  getCustomNotes(): string {
    return this.customNotes;
  }

  private getUploadsDir(): string {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'profile-uploads');
    } catch {
      return path.join(os.tmpdir(), 'profile-uploads');
    }
  }

  private buildResumeNodes(parsed: ResumeParsed): ResumeNode[] {
    const nodes: ResumeNode[] = [];
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

  private computeExperienceYears(
    experience: ResumeParsed['experience'],
  ): number | undefined {
    if (!experience || experience.length === 0) return undefined;
    const now = new Date().getFullYear();
    let totalYears = 0;
    for (const exp of experience) {
      const startMatch = exp.start?.match(/(\d{4})/);
      if (!startMatch) continue;
      const startYear = parseInt(startMatch[1], 10);
      let endYear = now;
      if (exp.end && !/present|now|current/i.test(exp.end)) {
        const endMatch = exp.end.match(/(\d{4})/);
        if (endMatch) endYear = parseInt(endMatch[1], 10);
      }
      if (!Number.isNaN(startYear) && !Number.isNaN(endYear) && endYear >= startYear) {
        totalYears += endYear - startYear;
      }
    }
    return totalYears > 0 ? totalYears : undefined;
  }
}
