/**
 * Premium Module Loader
 *
 * Uses Vite's import.meta.glob to optionally load premium components
 * from the premium/ directory. If the premium/ folder is removed
 * (open-source build), the globs return empty objects and no-op
 * fallbacks are used instead. No build errors.
 */
import React from 'react';
import { ModesSettingsBase } from '../components/settings/ModesSettingsBase';
import { NegotiationCoachingCard as NegotiationCoachingCardFallback } from '../components/NegotiationCoachingCard';

// ─── No-op fallbacks ────────────────────────────────────────────────
const NullComponent: React.FC<any> = () => null;

// ─── Glob-import premium modules (empty {} when premium/ is absent) ──
const _profileVis = import.meta.glob<any>(
  '../../premium/src/ProfileVisualizer.tsx',
  { eager: true }
);
const _modesSettings = import.meta.glob<any>(
  '../../premium/src/ModesSettings.tsx',
  { eager: true }
);
const _negotiationCard = import.meta.glob<any>(
  '../../premium/src/NegotiationCoachingCard.tsx',
  { eager: true }
);

// ─── Helper ──────────────────────────────────────────────────────────
function get<T>(mods: Record<string, any>, name: string, fallback: T): T {
  const mod = Object.values(mods)[0];
  return mod?.[name] ?? fallback;
}

// ─── Exports (always safe to import) ─────────────────────────────────
export const ProfileVisualizer: React.FC<any> =
  get(_profileVis, 'ProfileVisualizer', NullComponent);

export const ModesSettings: React.FC<any> =
  get(_modesSettings, 'default', ModesSettingsBase);

export const NegotiationCoachingCard: React.FC<any> =
  get(_negotiationCard, 'NegotiationCoachingCard', NegotiationCoachingCardFallback);
