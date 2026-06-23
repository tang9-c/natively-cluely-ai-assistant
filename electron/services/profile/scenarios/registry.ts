import type { ModeTemplateType } from '../../ModesManager';
import { defaultScenarioAdapters } from './adapters';
import type { ScenarioAdapter, ScenarioResolution, ScenarioType } from './types';

const DEFAULT_TEMPLATE_RESOLUTIONS: Record<ModeTemplateType, ScenarioResolution> = {
  sales: {
    templateType: 'sales',
    scenarioType: 'sales',
  },
  fde: {
    templateType: 'fde',
    scenarioType: 'fde',
  },
  'looking-for-work': {
    templateType: 'looking-for-work',
    scenarioType: 'interview',
    subScenario: 'candidate',
  },
  recruiting: {
    templateType: 'recruiting',
    scenarioType: 'interview',
    subScenario: 'recruiter',
  },
  'technical-interview': {
    templateType: 'technical-interview',
    scenarioType: 'interview',
    subScenario: 'technical',
  },
  lecture: {
    templateType: 'lecture',
    scenarioType: 'lecture',
  },
  'team-meet': {
    templateType: 'team-meet',
    scenarioType: 'team-meet',
  },
  general: {
    templateType: 'general',
    scenarioType: 'general',
  },
};

const DEFAULT_GENERAL_RESOLUTION: ScenarioResolution = {
  templateType: 'general',
  scenarioType: 'general',
};

export class ScenarioRegistry {
  private readonly adaptersByType: Map<ScenarioType, ScenarioAdapter>;

  constructor(
    adapters: ScenarioAdapter[],
    private readonly templateResolutions: Record<ModeTemplateType, ScenarioResolution>,
  ) {
    this.adaptersByType = new Map(adapters.map((adapter) => [adapter.type, adapter]));
  }

  static createDefault(): ScenarioRegistry {
    return new ScenarioRegistry(defaultScenarioAdapters, DEFAULT_TEMPLATE_RESOLUTIONS);
  }

  get(type: ScenarioType): ScenarioAdapter {
    const adapter = this.adaptersByType.get(type);
    if (!adapter) {
      throw new Error(`Unknown scenario type: ${type}`);
    }
    return adapter;
  }

  list(): ScenarioAdapter[] {
    return Array.from(this.adaptersByType.values());
  }

  resolveByTemplateType(templateType?: string | null): ScenarioResolution {
    if (!templateType) return DEFAULT_GENERAL_RESOLUTION;
    return this.templateResolutions[templateType as ModeTemplateType] ?? DEFAULT_GENERAL_RESOLUTION;
  }
}
