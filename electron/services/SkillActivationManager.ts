import { SkillsManager } from './SkillsManager';
import { SettingsManager } from './SettingsManager';

export type SkillActivationSource = 'default' | 'user' | 'voice' | 'auto' | 'post_call';
export type SkillActivationScope = 'global_default' | 'meeting' | 'session' | 'turn' | 'ephemeral';
export type SkillRequestType = 'what_to_answer' | 'chat' | 'post_call';

export interface SkillActivation {
  skillId: string;
  source: SkillActivationSource;
  scope: SkillActivationScope;
  activatedAt: number;
  expiresAt?: number;
  priority: number;
  reason?: string;
}

export interface ActivateSkillInput {
  skillId: string;
  source: SkillActivationSource;
  scope: Exclude<SkillActivationScope, 'global_default'>;
  now?: number;
  ttlMs?: number;
  reason?: string;
}

export interface ResolveSkillRequest {
  requestType: SkillRequestType;
  latestText?: string;
  now?: number;
  maxPromptTokens?: number;
}

export interface ResolvedActiveSkill {
  id: string;
  name: string;
  promptBlock: string;
  activation: SkillActivation;
}

const DEFAULT_EPHEMERAL_TTL_MS = 3 * 60 * 1000;
const DEFAULT_SKILL_PROMPT_TOKENS = 3000;

const SCOPE_PRIORITY: Record<SkillActivationScope, number> = {
  global_default: 10,
  session: 20,
  meeting: 30,
  ephemeral: 40,
  turn: 50,
};

const HUMANIZE_TRIGGERS: RegExp[] = [
  /\b(humanize this|make this sound natural|make it sound natural|less robotic|sounds like ai)\b/i,
  /(?:润色一下|自然一点|像真人一点|别太像ai|不要太像ai)/i,
];

export class SkillActivationManager {
  public static instance: SkillActivationManager | undefined;
  private activations: SkillActivation[] = [];

  public static getInstance(): SkillActivationManager {
    if (!SkillActivationManager.instance) {
      SkillActivationManager.instance = new SkillActivationManager();
    }
    return SkillActivationManager.instance;
  }

  public activateSkill(input: ActivateSkillInput): SkillActivation {
    const now = input.now ?? Date.now();
    const ttlMs = input.ttlMs ?? (input.scope === 'ephemeral' ? DEFAULT_EPHEMERAL_TTL_MS : undefined);
    const activation: SkillActivation = {
      skillId: this.normalizeSkillId(input.skillId),
      source: input.source,
      scope: input.scope,
      activatedAt: now,
      expiresAt: ttlMs ? now + ttlMs : undefined,
      priority: SCOPE_PRIORITY[input.scope],
      reason: input.reason,
    };

    this.activations = this.activations.filter(
      (item) => !(item.skillId === activation.skillId && item.scope === activation.scope)
    );
    this.activations.push(activation);
    return activation;
  }

  public deactivateSkill(skillId: string, scope?: SkillActivationScope): void {
    const wanted = this.normalizeSkillId(skillId);
    this.activations = this.activations.filter((item) => {
      if (item.skillId !== wanted) return true;
      return scope ? item.scope !== scope : false;
    });
  }

  public clearMeetingActivations(): void {
    this.activations = this.activations.filter(
      (item) => item.scope !== 'meeting' && item.scope !== 'ephemeral' && item.scope !== 'turn'
    );
  }

  public listActivations(now: number = Date.now()): SkillActivation[] {
    this.pruneExpired(now);
    return [...this.activations].sort(this.compareActivation);
  }

  public detectTrigger(text: string): { skillId: string; source: 'voice' | 'auto'; reason: string } | null {
    const trimmed = text.trim();
    if (!trimmed) return null;

    for (const pattern of HUMANIZE_TRIGGERS) {
      if (pattern.test(trimmed)) {
        return {
          skillId: 'humanize-ai-text',
          source: 'voice',
          reason: 'matched humanize trigger',
        };
      }
    }
    return null;
  }

  public resolveActiveSkill(request: ResolveSkillRequest): ResolvedActiveSkill | null {
    if (request.requestType !== 'what_to_answer') return null;

    const now = request.now ?? Date.now();
    this.pruneExpired(now);

    const hasTurnActivation = this.activations.some((activation) => activation.scope === 'turn');
    const trigger = !hasTurnActivation && request.latestText && this.getAutoTriggerEnabled()
      ? this.detectTrigger(request.latestText)
      : null;

    if (trigger) {
      this.activateSkill({
        skillId: trigger.skillId,
        source: trigger.source,
        scope: 'ephemeral',
        now,
        reason: trigger.reason,
      });
    }

    const candidates = [
      ...this.activations,
      ...this.getDefaultActivations(now),
    ].sort(this.compareActivation);

    for (const activation of candidates) {
      const skill = SkillsManager.getInstance().getSkill(activation.skillId);
      if (!skill) continue;

      const promptBlock = (SkillsManager.getInstance().buildPromptBlock as any)(skill, {
        maxTokens: request.maxPromptTokens ?? DEFAULT_SKILL_PROMPT_TOKENS,
      });

      if (activation.scope === 'turn') {
        this.deactivateSkill(activation.skillId, 'turn');
      }

      return {
        id: skill.id,
        name: skill.name,
        promptBlock,
        activation,
      };
    }

    return null;
  }

  private getDefaultActivations(now: number): SkillActivation[] {
    const ids = SettingsManager.getInstance().get('defaultActiveSkillIds') ?? [];
    if (!Array.isArray(ids)) return [];

    return ids
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((skillId) => ({
        skillId: this.normalizeSkillId(skillId),
        source: 'default' as const,
        scope: 'global_default' as const,
        activatedAt: now,
        priority: SCOPE_PRIORITY.global_default,
        reason: 'default setting',
      }));
  }

  private getAutoTriggerEnabled(): boolean {
    return SettingsManager.getInstance().get('skillsAutoTriggerEnabled') !== false;
  }

  private pruneExpired(now: number): void {
    this.activations = this.activations.filter((item) => !item.expiresAt || item.expiresAt > now);
  }

  private normalizeSkillId(skillId: string): string {
    return skillId.trim().toLowerCase();
  }

  private compareActivation(a: SkillActivation, b: SkillActivation): number {
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.activatedAt - a.activatedAt;
  }
}
