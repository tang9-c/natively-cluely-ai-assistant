import fs from 'fs';
import os from 'os';
import path from 'path';
import type { DocType, JDParsed, ProfileData, ResumeParsed } from './types';
import { ProfileDatabase } from './ProfileDatabase';
import { DocumentTextExtractor } from './DocumentTextExtractor';
import { ParserLLM } from './parsers/ParserLLM';
import { ResumeParser } from './parsers/ResumeParser';
import { JDParser } from './parsers/JDParser';
import { ScenarioContextService } from './ScenarioContextService';
import { redactForLog } from '../../utils/redactForLog';
import type {
  KnowledgeResult,
  ProfileOrchestratorRuntime,
} from './ProfileOrchestratorContract';
import { CompanyResearchEngine } from '../research/CompanyResearchEngine';
import { TavilySearchProvider } from '../research/TavilySearchProvider';
import { CompanyResearchCache } from '../research/CompanyResearchCache';
import { ResearchDossierBuilder } from '../research/ResearchDossierBuilder';
import { CredentialsManager } from '../CredentialsManager';
import type { ProfileResearchCompanyResponse } from '../research/types';

// Use a runtime require() so test stubs on the cached module exports
// object are visible to the orchestrator. esbuild inlines static
// `require()` calls into the bundle, but a dynamic expression built
// from a runtime variable is preserved as a real Node `require()` call
// at runtime, which goes through the module cache.
function readCredentialsModule(): any {
  const moduleMod = require('module') as typeof import('module');
  const dynamicRequire = moduleMod.createRequire(__filename);
  // In tests/source __filename points to this file, so ../CredentialsManager resolves
  // to electron/services/CredentialsManager. In the bundled app esbuild inlines this
  // module into main.js, so __dirname becomes dist-electron/electron and we need
  // ./services/CredentialsManager instead.
  const candidates = [
    path.join(__dirname, '..', 'CredentialsManager'),
    path.join(__dirname, 'services', 'CredentialsManager'),
  ];
  for (const candidate of candidates) {
    try {
      return dynamicRequire(candidate);
    } catch {}
  }
  // Fallback that preserves the original error message if nothing resolves.
  return dynamicRequire(path.join(__dirname, '..', 'CredentialsManager'));
}

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
  private llmHelper: any = null;
  researchEngine: CompanyResearchEngine | null = null;
  // Task 6: the four setXxxFn callbacks (generateContentFn,
  // liveCoachingContentFn, embedFn, embedQueryFn) were dead injection
  // surfaces — main.ts set them, the orchestrator stored them, nothing
  // read them. They were remnants of a "knowledge subsystem" design that
  // never landed. Removed in Task 6 along with their setters below.

  setLLMHelper(llmHelper: any): void {
    this.llmHelper = llmHelper;
    const parserLLM = new ParserLLM(llmHelper);
    this.resumeParser = new ResumeParser(parserLLM);
    this.jdParser = new JDParser(parserLLM);
    // Invalidate engine so it picks up the LLMHelper
    this.researchEngine = null;
  }

  async ingestDocument(
    filePath: string,
    docType: DocType,
  ): Promise<{ success: boolean; error?: string }> {
    let destPath: string | null = null;
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
      destPath = path.join(uploadsDir, `${prefix}-${Date.now()}${ext}`);
      fs.copyFileSync(filePath, destPath);

      // Task 4: parsing + DB write must roll back together. If anything throws
      // after we copied the file, we unlink the copy so the uploads directory
      // doesn't accumulate orphan files from failed parses.
      try {
        if (docType === 'resume') {
          if (!this.resumeParser) {
            throw new Error('Knowledge engine not initialized');
          }
          const parsed = await withTimeout(
            this.resumeParser.parse(rawText),
            60_000,
            'Resume parse',
          );
          // Atomic write to profile_master via better-sqlite3 transaction.
          this.db.saveResumeToMaster(parsed);
        } else if (docType === 'job_description') {
          if (!this.jdParser) {
            throw new Error('Knowledge engine not initialized');
          }
          const parsed = await withTimeout(
            this.jdParser.parse(rawText),
            60_000,
            'JD parse',
          );
          this.db.saveJD(rawText, parsed);
        }
      } catch (innerError) {
        // Parse or save failed — unlink the copied file so the user does
        // not accumulate junk uploads from failed attempts.
        if (destPath) {
          try { fs.unlinkSync(destPath); } catch { /* best effort */ }
        }
        throw innerError;
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
    // Task 4: read from profile_master (via synthesized ResumeParsed). The
    // legacy user_profile.structured_json path is gone (table dropped in v19).
    const parsed = this.db.getMasterAsResume();
    const hasResume = !!parsed;
    if (!hasResume) {
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

  async processQuestion(message: string): Promise<KnowledgeResult | null> {
    // Task 5: removed the early-return on !activeMode. The caller (LLMHelper)
    // already gates this call behind isKnowledgeMode(), so the redundant
    // guard here only served to silently disable injection when no active
    // mode was selected. ScenarioContextService.buildForRequest now falls
    // back to the 'general' templateType via resolveScenarioMode(), so a
    // knowledge-mode call without a chosen mode still injects the master
    // profile + persona (the request-scoped scenario context) instead of
    // returning null.
    //
    // Errors from buildForRequest now propagate to LLMHelper's outer
    // try/catch, which logs and degrades gracefully to a normal LLM call.
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
  }

  deleteDocumentsByType(docType: DocType): void {
    if (docType === 'resume') {
      this.db.clearMasterResume();
    } else if (docType === 'job_description') {
      this.db.clearJD();
    }
  }

  getProfileData(): ProfileData | null {
    // Task 4: synthesize ResumeParsed from profile_master instead of reading
    // the dropped user_profile.structured_json.
    const parsed = this.db.getMasterAsResume();
    if (!parsed) return null;

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

  getCompanyResearchEngine(): CompanyResearchEngine {
    if (!this.researchEngine) {
      const credsMod = readCredentialsModule();
      const apiKey =
        credsMod?.getTavilyApiKey?.() ??
        process.env.TAVILY_API_KEY ??
        '';
      const search = new TavilySearchProvider({ apiKey });
      const rawConn = this.db.getRawDb();
      if (!rawConn) {
        throw new Error(
          'Database not initialized. Company research requires a local SQLite database.',
        );
      }
      const cache = new CompanyResearchCache({ db: rawConn });
      const builder = new ResearchDossierBuilder({
        llm: {
          generateStructured: async (prompt, schema) => {
            if (!this.llmHelper) throw new Error('LLM not initialized');
            // LLMHelper exposes generateContentStructured(message) which returns a JSON
            // string. Parse it and validate against the Zod schema (the schema's
            // .parse() will throw on invalid shape, which the builder catches and
            // retries per its 1-retry policy).
            const raw = await this.llmHelper.generateContentStructured(prompt);
            return schema.parse(JSON.parse(raw));
          },
        },
      });
      this.researchEngine = new CompanyResearchEngine({ cache, search, builder });
    }
    return this.researchEngine;
  }

  async runCompanyResearch(
    companyName: string,
    options: { forceRefresh?: boolean; onProgress?: (p: any) => void } = {},
  ): Promise<ProfileResearchCompanyResponse> {
    const credsMod = readCredentialsModule();
    const apiKey = credsMod?.getTavilyApiKey?.();
    if (!apiKey) {
      return {
        success: false,
        errorCode: 'TAVILY_KEY_MISSING',
        error: '请在 Settings → Research 中配置 Tavily API key',
      };
    }
    const engine = this.getCompanyResearchEngine();
    return engine.research(companyName, options);
  }

  private getUploadsDir(): string {
    try {
      const { app } = require('electron');
      return path.join(app.getPath('userData'), 'profile-uploads');
    } catch {
      return path.join(os.tmpdir(), 'profile-uploads');
    }
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
