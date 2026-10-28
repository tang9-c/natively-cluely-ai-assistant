import { ONBOARDING_SCENARIOS } from '../../electron/test/onboardingFixtures';
import type { OnboardingScenario } from '../../electron/test/onboardingFixtures';
export { type OnboardingScenario };
export const onboardingScenarios = ONBOARDING_SCENARIOS;
export type OnboardingMode = 'fresh' | 'existing';
export function initialOnboardingSettings(mode: OnboardingMode, scenario: OnboardingScenario) {
  if (scenario === 'unknown-schema') return { onboarding: { version: 999, future: true } };
  if (mode === 'fresh' && !['ready', 'download-running', 'defer-save-failed', 'scope-denied'].includes(scenario)) return {};
  if (scenario === 'scope-denied') return { providerDataScopes: { transcript: false } };
  const receipts = ['ready', 'download-running', 'defer-save-failed'].includes(scenario) ? Object.fromEntries((scenario === 'download-running' ? ['ai'] : ['stt', 'ai']).map(target => [target, {
    target, provider: target === 'stt' ? 'local-sensevoice' : 'doubao', modelId: target === 'stt' ? 'fixture-sensevoice' : 'fixture-ai',
    configRevision: 0, configIdentity: `fixture-${target}`, checkedAt: 1, depth: target === 'stt' ? 'model_load' : 'model_response', result: 'passed',
  }])) : {};
  return { onboarding: { version: 1, origin: mode, lastStep: 'overview', meetingHintsDismissed: { transcript: false, answer: false },
    acceptedSystemAudioLimitation: false, configRevision: { stt: 0, ai: 0 }, validationReceipts: receipts } };
}
