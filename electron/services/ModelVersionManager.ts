/**
 * ModelVersionManager — Static fallback chain constants.
 *
 * Replaces the previous 1,200-line auto-discovery + 3-tier promotion system.
 * All tiers now return the same hardcoded stable model IDs. If a model is
 * deprecated, update this file directly.
 */

export enum ModelFamily {
  OPENAI = 'openai',
  GEMINI_FLASH = 'gemini_flash',
  GEMINI_PRO = 'gemini_pro',
  CLAUDE = 'claude',
  GROQ_LLAMA = 'groq_llama',
}

export enum TextModelFamily {
  OPENAI = 'text_openai',
  GEMINI_FLASH = 'text_gemini_flash',
  GEMINI_PRO = 'text_gemini_pro',
  CLAUDE = 'text_claude',
  GROQ = 'text_groq',
}

export interface TieredModels {
  tier1: string;
  tier2: string;
  tier3: string;
}

/** Vision-capable model ordering for screenshot analysis */
export const VISION_PROVIDER_ORDER: ModelFamily[] = [
  ModelFamily.OPENAI,
  ModelFamily.GEMINI_FLASH,
  ModelFamily.CLAUDE,
  ModelFamily.GEMINI_PRO,
  ModelFamily.GROQ_LLAMA,
];

/** Text model ordering for chat fallback chains */
export const TEXT_PROVIDER_ORDER: TextModelFamily[] = [
  TextModelFamily.GROQ,
  TextModelFamily.OPENAI,
  TextModelFamily.CLAUDE,
  TextModelFamily.GEMINI_FLASH,
  TextModelFamily.GEMINI_PRO,
];

/** Static vision fallback chain: all tiers use the same stable model */
export const VISION_FALLBACK_CHAIN: Record<ModelFamily, string[]> = {
  [ModelFamily.OPENAI]: ['gpt-4.1', 'gpt-4.1', 'gpt-4.1'],
  [ModelFamily.GEMINI_FLASH]: ['gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20'],
  [ModelFamily.GEMINI_PRO]: ['gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05'],
  [ModelFamily.CLAUDE]: ['claude-sonnet-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-5'],
  [ModelFamily.GROQ_LLAMA]: ['meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-scout-17b-16e-instruct'],
};

/** Static text fallback chain: all tiers use the same stable model */
export const TEXT_FALLBACK_CHAIN: Record<TextModelFamily, string[]> = {
  [TextModelFamily.OPENAI]: ['gpt-4.1', 'gpt-4.1', 'gpt-4.1'],
  [TextModelFamily.GEMINI_FLASH]: ['gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20', 'gemini-2.5-flash-preview-05-20'],
  [TextModelFamily.GEMINI_PRO]: ['gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05', 'gemini-2.5-pro-preview-06-05'],
  [TextModelFamily.CLAUDE]: ['claude-sonnet-4-5', 'claude-sonnet-4-5', 'claude-sonnet-4-5'],
  [TextModelFamily.GROQ]: ['llama-3.3-70b-versatile', 'llama-3.3-70b-versatile', 'llama-3.3-70b-versatile'],
};

/** No-op stub that preserves the old class interface for minimal churn.
 *  All methods return the static chains above. */
export class ModelVersionManager {
  public setApiKeys(_keys: unknown): void { /* no-op */ }

  public async initialize(): Promise<void> { /* no-op */ }

  public stopScheduler(): void { /* no-op */ }

  public getTieredModels(family: ModelFamily): TieredModels {
    const [tier1, tier2, tier3] = VISION_FALLBACK_CHAIN[family] ?? ['', '', ''];
    return { tier1, tier2, tier3 };
  }

  public getAllVisionTiers(): Array<{ family: ModelFamily } & TieredModels> {
    return VISION_PROVIDER_ORDER.map(family => ({
      family,
      ...this.getTieredModels(family),
    }));
  }

  public getTextTieredModels(family: TextModelFamily): TieredModels {
    const [tier1, tier2, tier3] = TEXT_FALLBACK_CHAIN[family] ?? ['', '', ''];
    return { tier1, tier2, tier3 };
  }

  public getAllTextTiers(): Array<{ family: TextModelFamily } & TieredModels> {
    return TEXT_PROVIDER_ORDER.map(family => ({
      family,
      ...this.getTextTieredModels(family),
    }));
  }

  public async onModelError(_failedModelId: string): Promise<void> { /* no-op */ }

  public rollback(_family: ModelFamily | TextModelFamily): boolean { return false; }

  public getSummary(): string {
    const lines = ['[ModelVersionManager] Static fallback chains:'];
    lines.push('  --- Vision ---');
    for (const family of VISION_PROVIDER_ORDER) {
      const t = this.getTieredModels(family);
      lines.push(`  ${family}: T1=${t.tier1} | T2/T3=${t.tier2}`);
    }
    lines.push('  --- Text ---');
    for (const family of TEXT_PROVIDER_ORDER) {
      const t = this.getTextTieredModels(family);
      lines.push(`  ${family}: T1=${t.tier1} | T2/T3=${t.tier2}`);
    }
    return lines.join('\n');
  }
}
