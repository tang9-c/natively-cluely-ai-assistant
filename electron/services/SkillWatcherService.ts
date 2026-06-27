import { SettingsManager } from './SettingsManager';

export interface SkillWatcherSettings {
  skillsWatcherEnabled: boolean;
  skillsWatcherAutoActivateThreshold: number;
  skillsWatcherSuggestThreshold: number;
}

export interface SkillWatcherDecision {
  id: string;
  skillId: string;
  action: 'activate' | 'suggest' | 'ignore';
  scope: 'meeting' | 'ephemeral';
  confidence: number;
  reason: string;
  expiresAt?: number;
}

export interface SkillWatcherSuggestion extends SkillWatcherDecision {
  action: 'suggest';
  createdAt: number;
  status: 'pending' | 'accepted' | 'dismissed';
}

export interface SkillWatcherInput {
  now?: number;
  transcriptWindow: Array<{ speaker?: string; text: string; timestamp?: number }>;
  skills: Array<{ id: string; name: string; description?: string; source: 'builtin' | 'userData' }>;
  activations: Array<{ skillId: string; scope: string; expiresAt?: number }>;
}

const DEFAULT_SETTINGS: SkillWatcherSettings = {
  skillsWatcherEnabled: false,
  skillsWatcherAutoActivateThreshold: 0.86,
  skillsWatcherSuggestThreshold: 0.65,
};

const MIN_INTERVAL_MS = 45_000;
const SUGGESTION_COOLDOWN_MS = 5 * 60_000;
const DEFAULT_EPHEMERAL_TTL_MS = 3 * 60_000;

export class SkillWatcherService {
  private static instance: SkillWatcherService | null = null;
  private settings: SkillWatcherSettings;
  private suggestions: SkillWatcherSuggestion[] = [];
  private lastRunAt = 0;
  private lastFingerprint = '';
  private dismissedKeys = new Map<string, number>();

  constructor(settings?: Partial<SkillWatcherSettings>) {
    this.settings = {
      ...DEFAULT_SETTINGS,
      ...settings,
    };
  }

  public static getInstance(): SkillWatcherService {
    if (!SkillWatcherService.instance) {
      SkillWatcherService.instance = new SkillWatcherService(loadPersistedSettings());
    }
    return SkillWatcherService.instance;
  }

  public getSettings(): SkillWatcherSettings {
    return { ...this.settings };
  }

  public setSettings(input: Partial<SkillWatcherSettings>): SkillWatcherSettings {
    this.settings = {
      skillsWatcherEnabled: input.skillsWatcherEnabled ?? this.settings.skillsWatcherEnabled,
      skillsWatcherAutoActivateThreshold: clampThreshold(
        input.skillsWatcherAutoActivateThreshold ?? this.settings.skillsWatcherAutoActivateThreshold,
        DEFAULT_SETTINGS.skillsWatcherAutoActivateThreshold,
      ),
      skillsWatcherSuggestThreshold: clampThreshold(
        input.skillsWatcherSuggestThreshold ?? this.settings.skillsWatcherSuggestThreshold,
        DEFAULT_SETTINGS.skillsWatcherSuggestThreshold,
      ),
    };

    persistSettings(this.settings);
    return this.getSettings();
  }

  public evaluate(input: SkillWatcherInput): SkillWatcherDecision {
    const now = input.now ?? Date.now();
    if (!this.settings.skillsWatcherEnabled) {
      return ignoreDecision('disabled', now);
    }

    if (now - this.lastRunAt < MIN_INTERVAL_MS) {
      return ignoreDecision('rate_limited', now);
    }

    const text = input.transcriptWindow.map((segment) => segment.text).join('\n').trim();
    const fingerprint = normalizeText(text).slice(-240);
    if (!fingerprint || fingerprint === this.lastFingerprint) {
      return ignoreDecision('unchanged_transcript', now);
    }

    this.lastRunAt = now;
    this.lastFingerprint = fingerprint;

    const skill = input.skills.find((item) => item.id === 'humanize-ai-text');
    if (!skill) {
      return ignoreDecision('skill_unavailable', now);
    }

    if (input.activations.some((activation) => activation.skillId === skill.id && isActivationLive(activation, now))) {
      return ignoreDecision('already_active', now, skill.id);
    }

    const confidence = scoreHumanizeIntent(text);
    const key = `${skill.id}:${Math.round(confidence * 100)}`;
    const dismissedAt = this.dismissedKeys.get(key);
    if (dismissedAt && now - dismissedAt < SUGGESTION_COOLDOWN_MS) {
      return ignoreDecision('dismissed_recently', now, skill.id);
    }

    if (confidence >= this.settings.skillsWatcherAutoActivateThreshold) {
      return {
        id: createDecisionId(skill.id, now),
        skillId: skill.id,
        action: 'activate',
        scope: 'ephemeral',
        confidence,
        reason: 'humanize_intent_high',
        expiresAt: now + DEFAULT_EPHEMERAL_TTL_MS,
      };
    }

    if (confidence >= this.settings.skillsWatcherSuggestThreshold) {
      const suggestion: SkillWatcherSuggestion = {
        id: createDecisionId(skill.id, now),
        skillId: skill.id,
        action: 'suggest',
        scope: 'ephemeral',
        confidence,
        reason: 'humanize_intent_medium',
        expiresAt: now + DEFAULT_EPHEMERAL_TTL_MS,
        createdAt: now,
        status: 'pending',
      };
      this.suggestions = [suggestion, ...this.suggestions.filter((item) => item.skillId !== skill.id)].slice(0, 10);
      return suggestion;
    }

    return ignoreDecision('below_threshold', now, skill.id, confidence);
  }

  public listSuggestions(now: number = Date.now()): SkillWatcherSuggestion[] {
    return this.suggestions
      .filter((item) => item.status === 'pending' && (!item.expiresAt || item.expiresAt > now))
      .map((item) => ({ ...item }));
  }

  public acceptSuggestion(id: string, now: number = Date.now()): SkillWatcherSuggestion | null {
    const suggestion = this.suggestions.find((item) => item.id === id && item.status === 'pending');
    if (!suggestion || (suggestion.expiresAt && suggestion.expiresAt <= now)) {
      return null;
    }
    suggestion.status = 'accepted';
    return { ...suggestion };
  }

  public dismissSuggestion(id: string, now: number = Date.now()): SkillWatcherSuggestion | null {
    const suggestion = this.suggestions.find((item) => item.id === id && item.status === 'pending');
    if (!suggestion) {
      return null;
    }
    suggestion.status = 'dismissed';
    this.dismissedKeys.set(`${suggestion.skillId}:${Math.round(suggestion.confidence * 100)}`, now);
    return { ...suggestion };
  }

  public clearSessionState(): void {
    this.suggestions = [];
    this.lastRunAt = 0;
    this.lastFingerprint = '';
    this.dismissedKeys.clear();
  }
}

function loadPersistedSettings(): SkillWatcherSettings {
  try {
    const settings = SettingsManager.getInstance();
    return {
      skillsWatcherEnabled: settings.get('skillsWatcherEnabled') === true,
      skillsWatcherAutoActivateThreshold: clampThreshold(
        Number(settings.get('skillsWatcherAutoActivateThreshold') ?? DEFAULT_SETTINGS.skillsWatcherAutoActivateThreshold),
        DEFAULT_SETTINGS.skillsWatcherAutoActivateThreshold,
      ),
      skillsWatcherSuggestThreshold: clampThreshold(
        Number(settings.get('skillsWatcherSuggestThreshold') ?? DEFAULT_SETTINGS.skillsWatcherSuggestThreshold),
        DEFAULT_SETTINGS.skillsWatcherSuggestThreshold,
      ),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function persistSettings(settings: SkillWatcherSettings): void {
  try {
    const manager = SettingsManager.getInstance();
    manager.set('skillsWatcherEnabled', settings.skillsWatcherEnabled);
    manager.set('skillsWatcherAutoActivateThreshold', settings.skillsWatcherAutoActivateThreshold);
    manager.set('skillsWatcherSuggestThreshold', settings.skillsWatcherSuggestThreshold);
  } catch {
    // Settings persistence is best-effort; the in-memory watcher still works.
  }
}

function clampThreshold(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : fallback;
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function scoreHumanizeIntent(text: string): number {
  const normalized = normalizeText(text);
  if (/(please\s+)?humanize|sound\s+more\s+human|ai[-\s]?sounding|sounds?\s+like\s+ai|自然一点|像真人|人味/.test(normalized)) {
    return 0.9;
  }
  if (/robotic|stiff|too formal|less formal|more natural|不自然|太官方|太生硬/.test(normalized)) {
    return 0.72;
  }
  return 0.0;
}

function createDecisionId(skillId: string, now: number): string {
  return `${skillId}-${now}`;
}

function ignoreDecision(reason: string, now: number, skillId = '', confidence = 0): SkillWatcherDecision {
  return {
    id: createDecisionId(skillId || 'ignore', now),
    skillId,
    action: 'ignore',
    scope: 'ephemeral',
    confidence,
    reason,
  };
}

function isActivationLive(activation: { expiresAt?: number }, now: number): boolean {
  return !activation.expiresAt || activation.expiresAt > now;
}
