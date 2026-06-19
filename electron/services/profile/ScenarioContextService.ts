import { DatabaseManager } from '../../db/DatabaseManager';
import { ModesManager } from '../ModesManager';
import { ScenarioRegistry } from './scenarios/registry';
import type { ScenarioContextBuildResult, ScenarioDocSubtype } from './scenarios/types';
import type { ProviderDataScope } from '../../llm/ProviderRouter';

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
  /** Maximum characters of the user persona to inject into the context block. */
  personaMaxChars?: number;
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
  private readonly personaMaxChars: number;
  private readonly masterProfileMaxChars: number;

  constructor(deps: ScenarioContextServiceDeps = {}) {
    this.registry = deps.registry ?? ScenarioRegistry.createDefault();
    this.modesManager = deps.modesManager ?? ModesManager.getInstance();
    this.db = deps.db ?? DatabaseManager.getInstance();
    this.personaMaxChars =
      typeof deps.personaMaxChars === 'number' && deps.personaMaxChars >= 0
        ? deps.personaMaxChars
        : DEFAULT_CONTEXT_CHARS;
    this.masterProfileMaxChars =
      typeof deps.masterProfileMaxChars === 'number' && deps.masterProfileMaxChars >= 0
        ? deps.masterProfileMaxChars
        : DEFAULT_CONTEXT_CHARS;
  }

  async buildForRequest(input: BuildForRequestInput): Promise<ScenarioContextBuildResult> {
    const activeMode = this.modesManager.getActiveMode();
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

    const files = this.modesManager.getReferenceFiles(activeMode.id);
    const metadataRows = this.db.getModeReferenceFileMetadataForMode(activeMode.id);
    const metadataByFileId = new Map(metadataRows.map((row: any) => [row.reference_file_id, row]));
    const documentBlocks: string[] = [];

    for (const file of files) {
      const metadata = metadataByFileId.get(file.id);
      if (!metadata) continue;
      if (metadata.scenario_type !== resolution.scenarioType) continue;
      documentBlocks.push(adapter.formatDocumentContext({
        subtype: metadata.doc_subtype as ScenarioDocSubtype,
        title: file.fileName,
        source: file.fileName,
        content: file.content ?? '',
      }));
    }

    if (documentBlocks.length > 0) {
      contextParts.push([
        '<scenario_documents>',
        ...documentBlocks,
        '</scenario_documents>',
      ].join('\n'));
      dataScopes.add('reference_files');
    }

    const masterProfile = this.buildMasterProfileBlock(this.db);
    if (masterProfile) {
      contextParts.push(masterProfile);
      dataScopes.add('profile_history');
    }

    const persona = typeof (this.db as any).getPersona === 'function' ? (this.db as any).getPersona() : '';
    if (persona?.trim()) {
      contextParts.push(`<scenario_persona>${escapeXml(persona.trim().slice(0, this.personaMaxChars))}</scenario_persona>`);
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
    if (typeof (db as any).getUserProfile !== 'function') return '';
    const profile = (db as any).getUserProfile();
    if (!profile?.structured_json) return '';

    const parsed = safeJsonParse(profile.structured_json);
    if (!parsed) return '';

    const payload = JSON.stringify(parsed).slice(0, this.masterProfileMaxChars);
    return `<profile_master format="json">${escapeXml(payload)}</profile_master>`;
  }
}
