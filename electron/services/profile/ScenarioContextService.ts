import { DatabaseManager } from '../../db/DatabaseManager';
import { ModesManager } from '../ModesManager';
import { ScenarioRegistry } from './scenarios/registry';
import type { ScenarioContextBuildResult } from './scenarios/types';
import type { ProviderDataScope } from '../../llm/ProviderRouter';
import {
  DOSSIER_SCHEMA_VERSION,
  isCompanyDossier,
} from '../../../shared/companyResearch';
import { buildCompanyResearchEvidence } from '../research/CompanyResearchContext';

interface BuildForRequestInput {
  query: string;
  transcript?: string;
  tokenBudget?: number;
  includeSystemPrompt?: boolean;
}

interface ScenarioContextServiceDeps {
  modesManager?: ModesManager;
  db?: DatabaseManager;
  registry?: ScenarioRegistry;
  /** Maximum characters of the master profile JSON to inject into the context block. */
  masterProfileMaxChars?: number;
}

function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&apos;';
      default:
        return char;
    }
  });
}

function safeJsonParse(value: string | null | undefined): unknown | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

/** Default ceiling for persona/master-profile character budgets when callers do not override. */
const DEFAULT_CONTEXT_CHARS = 4000;

export class ScenarioContextService {
  private readonly registry: ScenarioRegistry;
  private readonly modesManager: ModesManager;
  private readonly db: DatabaseManager;
  private readonly masterProfileMaxChars: number;

  constructor(deps: ScenarioContextServiceDeps = {}) {
    this.registry = deps.registry ?? ScenarioRegistry.createDefault();
    this.modesManager = deps.modesManager ?? ModesManager.getInstance();
    this.db = deps.db ?? DatabaseManager.getInstance();
    this.masterProfileMaxChars =
      typeof deps.masterProfileMaxChars === 'number' && deps.masterProfileMaxChars >= 0
        ? deps.masterProfileMaxChars
        : DEFAULT_CONTEXT_CHARS;
  }

  async buildForRequest(input: BuildForRequestInput): Promise<ScenarioContextBuildResult> {
    const activeMode = this.resolveScenarioMode();
    if (!activeMode) {
      return { systemPromptSuffix: '', contextBlock: '', dataScopes: [] };
    }

    const resolution = this.registry.resolveByTemplateType(activeMode.templateType);
    const adapter = this.registry.get(resolution.scenarioType);
    const contextParts: string[] = [];
    const dataScopes = new Set<ProviderDataScope>();

    const retrievedContext = await this.getRetrievedModeContext(this.modesManager, input);
    if (retrievedContext) {
      contextParts.push(retrievedContext);
      dataScopes.add('reference_files');
    }

    const companyResearch = this.buildCompanyResearchBlock(activeMode.templateType);
    if (companyResearch) {
      contextParts.push(companyResearch);
      dataScopes.add('profile_history');
    }

    const masterProfile = this.buildMasterProfileBlock(this.db);
    if (masterProfile) {
      contextParts.push(masterProfile);
      dataScopes.add('profile_history');
    }

    return {
      systemPromptSuffix: input.includeSystemPrompt === false
        ? ''
        : adapter.getSystemPromptSuffix(resolution),
      contextBlock: contextParts.join('\n\n'),
      dataScopes: Array.from(dataScopes),
    };
  }

  private resolveScenarioMode(): any | null {
    const activeMode = this.modesManager.getActiveMode();
    if (activeMode) return activeMode;

    if (typeof (this.modesManager as any).ensureSeeded === 'function') {
      (this.modesManager as any).ensureSeeded();
    }
    if (typeof (this.modesManager as any).getModes !== 'function') {
      return null;
    }
    return (this.modesManager as any)
      .getModes()
      .find((mode: any) => mode?.templateType === 'general') ?? null;
  }

  private async getRetrievedModeContext(
    modesManager: ModesManager,
    input: BuildForRequestInput,
  ): Promise<string> {
    try {
      if (typeof modesManager.buildRetrievedActiveModeContextBlockHybrid === 'function') {
        const hybrid = await modesManager.buildRetrievedActiveModeContextBlockHybrid(
          input.query,
          input.transcript,
          input.tokenBudget,
        );
        if (hybrid) return hybrid;
      }
    } catch (error: any) {
      console.warn('[ScenarioContextService] hybrid mode context failed:', error?.message);
    }

    try {
      return modesManager.buildRetrievedActiveModeContextBlock(
        input.query,
        input.transcript,
        input.tokenBudget,
      ) || '';
    } catch (error: any) {
      console.warn('[ScenarioContextService] lexical mode context failed:', error?.message);
      return '';
    }
  }

  private buildMasterProfileBlock(db: DatabaseManager): string {
    // Task 3: read from profile_master (the structured profile_master table),
    // not from user_profile.structured_json. The legacy user_profile table is
    // dropped by the v19 migration; the new master profile is the single source
    // of truth and is edited through MasterProfileSection in the UI.
    const profile = typeof db.getProfileMaster === 'function' ? db.getProfileMaster() : null;
    if (!profile) return '';

    const displayName = (profile.display_name ?? '').toString().trim();
    const headline = (profile.headline ?? '').toString().trim();
    const summary = (profile.summary ?? '').toString().trim();
    const experience = safeJsonParse(profile.experience_json);
    const skills = safeJsonParse(profile.skills_json);
    const contactInfo = safeJsonParse(profile.contact_info_json);

    const hasContent =
      displayName.length > 0 ||
      headline.length > 0 ||
      summary.length > 0 ||
      (Array.isArray(experience) && experience.length > 0) ||
      (Array.isArray(skills) && skills.length > 0);
    if (!hasContent) return '';

    const payload = JSON.stringify({
      display_name: displayName,
      headline,
      summary,
      contact_info: contactInfo ?? {},
      experience: Array.isArray(experience) ? experience : [],
      skills: Array.isArray(skills) ? skills : [],
    }).slice(0, this.masterProfileMaxChars);

    return `<profile_master format="json">${escapeXml(payload)}</profile_master>`;
  }

  private buildCompanyResearchBlock(templateType: string): string {
    if (templateType !== 'looking-for-work' && templateType !== 'recruiting') return '';
    if (
      typeof this.db.getActiveJD !== 'function'
      || typeof this.db.getCompanyResearchCache !== 'function'
    ) return '';

    try {
      const activeJD = this.db.getActiveJD();
      const parsedJD = safeJsonParse(activeJD?.parsed_json) as Record<string, unknown> | undefined;
      const companyName = typeof parsedJD?.company === 'string'
        ? parsedJD.company.trim().replace(/\s+/g, ' ')
        : '';
      if (!companyName) return '';

      const cache = this.db.getCompanyResearchCache(companyName);
      if (!cache || cache.schema_version !== DOSSIER_SCHEMA_VERSION) return '';
      const expiresAt = Date.parse(cache.expires_at);
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return '';

      const dossier = safeJsonParse(cache.dossier_json);
      if (!isCompanyDossier(dossier)) return '';
      return buildCompanyResearchEvidence(dossier);
    } catch {
      return '';
    }
  }
}
