import { EventEmitter } from 'events';
import type { OnboardingCheck, OnboardingDeviceSelection, OnboardingSnapshot, ValidationTarget } from '../../shared/onboarding';
import type { ValidationEvidence } from '../services/onboarding/OnboardingValidation';
export const ONBOARDING_SCENARIOS = ['none', 'missing-services', 'ready', 'model-load-failed', 'scope-denied', 'download-running', 'storage-failed', 'unknown-schema', 'permission-denied', 'audio-fallback', 'save-failed', 'ai-network-failed', 'codex-unsupported', 'language-unsupported', 'download-error', 'defer-save-failed', 'whisper-current'] as const;
export type OnboardingScenario = typeof ONBOARDING_SCENARIOS[number];
/** This module is built only for development and dynamically loaded behind three guards. */
export function createOnboardingFixture(scenario: string, environment: { e2e: boolean; enabled: boolean; packaged: boolean }) {
  if (environment.packaged || !environment.e2e || !environment.enabled) return null;
  if (!ONBOARDING_SCENARIOS.includes(scenario as OnboardingScenario) || scenario === 'none') throw new Error('invalid_onboarding_scenario');
  let currentTime = 1000;
  const counters = { reads: 0, validations: 0, audioStarts: 0, audioStops: 0 };
  const devices = [{ id: 'fixture-input', name: '测试麦克风' }];
  const permissions = { platform: scenario === 'permission-denied' ? 'darwin' : 'fixture', microphone: scenario === 'permission-denied' ? 'denied' : 'granted', screen: scenario === 'permission-denied' ? 'denied' : 'granted' };
  const outputs = [{ id: 'fixture-output', name: '测试扬声器' }];
  let modelAvailable = !['missing-services', 'download-error'].includes(scenario);
  let changed = 0;
  const configured: Record<string, boolean> = { stt: scenario !== 'missing-services', ai: !['missing-services', 'save-failed'].includes(scenario) };
  const selected = { stt: scenario === 'whisper-current' ? 'local-whisper' : 'local-sensevoice', ai: scenario === 'codex-unsupported' ? 'codex-cli' : 'doubao' };
  const models = { stt: 'fixture-sensevoice', ai: 'fixture-ai' };
  const readConfiguration = (target: ValidationTarget): OnboardingCheck => ({ configured: configured[target], status: 'missing', provider: selected[target],
    modelId: models[target], configIdentity: `fixture-${target}${changed ? `-${changed}` : ''}`,
    ...(target === 'stt' && scenario === 'language-unsupported' ? { errorCode: 'unsupported_check' as const, messageKey: 'onboarding.language_unsupported' } : {}),
    ...(target === 'ai' && scenario === 'scope-denied' ? { errorCode: 'scope_denied' as const } : {}) });
  return {
    scenario, counters, devices, outputs,
    rejectProgress: (progress: { deferredAt?: number }) => scenario === 'defer-save-failed' && progress.deferredAt !== undefined,
    now: () => currentTime,
    advanceTime: (milliseconds: number) => {
      if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new Error('invalid_fixture_time');
      currentTime += milliseconds;
    },
    readConfiguration,
    saveConfiguration: (target: ValidationTarget, patch: { provider?: string; modelId?: string } = {}) => {
      if (scenario === 'save-failed') return false;
      if (patch.provider) selected[target] = patch.provider;
      if (patch.modelId) models[target] = patch.modelId;
      configured[target] = true; changed++; return true;
    },
    completeDownload: () => { modelAvailable = true; },
    modelCatalog: () => ({ models: [{ id: models.stt, name: 'SenseVoice 测试模型', sizeMb: 250, status: modelAvailable ? 'available' : 'missing' }, ...(scenario === 'whisper-current' ? [{ id: 'fixture-whisper-alternative', name: 'Whisper 备用模型', sizeMb: 150, status: 'available' }] : [])], activeModelId: models.stt }),
    readChecks: async (selection: OnboardingDeviceSelection = {}): Promise<OnboardingSnapshot['checks']> => {
      counters.reads++;
      return { microphone: permissions.microphone === 'denied' ? { status: 'failed', errorCode: 'permission_denied' } : { status: 'verified', evidenceSource: 'runtime' },
        inputDevice: devices.length > 0 && (!selection.inputDeviceId || devices.some(d => d.id === selection.inputDeviceId) || selection.inputDeviceId === 'default')
          ? { status: 'verified', evidenceSource: 'runtime' } : { status: 'missing', errorCode: 'device_missing' },
        systemAudio: permissions.screen === 'denied' ? { status: 'limited', errorCode: 'permission_denied' } : { status: 'verified', evidenceSource: 'runtime' }, stt: readConfiguration('stt'), ai: readConfiguration('ai') };
    },
    execute: async (target: ValidationTarget, check: OnboardingCheck, signal: AbortSignal): Promise<ValidationEvidence> => {
      counters.validations++;
      if (signal.aborted) throw Object.assign(new Error('timeout'), { code: 'timeout' });
      if (target === 'ai' && scenario === 'codex-unsupported') throw Object.assign(new Error('unsupported_check'), { code: 'unsupported_check' });
      if (target === 'ai' && scenario === 'ai-network-failed') throw Object.assign(new Error('network_error'), { code: 'network_error' });
      if (target === 'stt' && scenario === 'model-load-failed') throw Object.assign(new Error('model_load_failed'), { code: 'model_load_failed' });
      return { provider: check.provider!, modelId: check.modelId, depth: target === 'stt' ? check.provider?.startsWith('local-') ? 'model_load' : 'credential_access' : 'model_response' };
    },
    createCapture: (deviceId?: string) => {
      if (scenario === 'audio-fallback' && deviceId && deviceId !== 'default') throw new Error('fixture_device_missing');
      const capture = new EventEmitter() as EventEmitter & { start(): void; destroy(): Promise<void> };
      capture.start = () => { counters.audioStarts++; };
      capture.destroy = async () => { counters.audioStops++; capture.removeAllListeners(); };
      return capture;
    },
    permissions,
    saveProgress: scenario === 'storage-failed' ? () => { throw new Error('fixture_storage_failed'); } : undefined,
  };
}
export type OnboardingFixture = NonNullable<ReturnType<typeof createOnboardingFixture>>;
