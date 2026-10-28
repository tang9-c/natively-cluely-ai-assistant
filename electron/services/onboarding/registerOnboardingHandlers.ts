import type { OnboardingDeviceSelection, OnboardingProgressAction, OnboardingSnapshot, OnboardingStateResult, OnboardingStep } from '../../../shared/onboarding';
import { OnboardingError, OnboardingService } from './OnboardingService';
import type { OnboardingValidation } from './OnboardingValidation';
export type OnboardingSenderRole = 'launcher' | 'settings' | 'overlay';
interface Registration {
    safeHandle(channel: string, callback: (event: any, ...args: any[]) => unknown): void;
    service: OnboardingService;
    validator: Pick<OnboardingValidation, 'validate'>;
    getSenderRole(event: any): OnboardingSenderRole | undefined;
    onLauncherReady?(): void;
    openLauncher(input: { step?: OnboardingStep }): void;
    broadcast(channel: string, snapshot: OnboardingSnapshot): void;
}
const subscriptions = new WeakMap<OnboardingService, () => void>();
const steps: OnboardingStep[] = ['overview', 'permissions', 'speech', 'ai', 'ready'];
export function registerOnboardingHandlers(deps: Registration): void {
    const { service, safeHandle } = deps;
    const stateResult = async (operation: () => OnboardingSnapshot | Promise<OnboardingSnapshot>): Promise<OnboardingStateResult> => {
        try { return { success: true, snapshot: await operation() }; }
        catch (error) {
            const code = (error as OnboardingError)?.messageKey === `onboarding.${(error as OnboardingError)?.code}` ? (error as OnboardingError).code : 'storage_failed';
            return { success: false, errorCode: code, messageKey: `onboarding.${code}` };
        }
    };
    const assertRole = (event: any): OnboardingSenderRole => {
        const role = deps.getSenderRole(event);
        if (!role) throw new OnboardingError('forbidden');
        return role;
    };
    safeHandle('get-onboarding-state', (event, selection?: OnboardingDeviceSelection) => stateResult(async () => {
        const role = assertRole(event);
        if (selection !== undefined && role !== 'launcher') throw new OnboardingError('forbidden');
        if (role === 'launcher') deps.onLauncherReady?.();
        return service.refreshChecks(selection);
    }));
    safeHandle('update-onboarding-progress', (event, action: OnboardingProgressAction) => stateResult(async () => {
        const role = assertRole(event);
        if (role !== 'launcher' && !(role === 'overlay' && action?.type === 'dismiss-hint')) throw new OnboardingError('forbidden');
        return service.applyAction(action);
    }));
    safeHandle('validate-onboarding-service', async (event, input: { target?: unknown; expectedRevision?: unknown }) => {
        try {
            if (assertRole(event) !== 'launcher') throw new OnboardingError('forbidden');
            if (!input || !['stt', 'ai'].includes(input.target as string) || !Number.isSafeInteger(input.expectedRevision)
                || (input.expectedRevision as number) < 0 || Object.keys(input).some(key => !['target', 'expectedRevision'].includes(key))) throw new OnboardingError('invalid_request');
            return await deps.validator.validate(input.target as 'stt' | 'ai', input.expectedRevision as number);
        } catch (error) {
            const code = (error as OnboardingError)?.messageKey === `onboarding.${(error as OnboardingError)?.code}` ? (error as OnboardingError).code : 'storage_failed';
            return { success: false, errorCode: code, messageKey: `onboarding.${code}` };
        }
    });
    safeHandle('open-onboarding', (event, input: { step?: OnboardingStep } = {}) => {
        try {
            assertRole(event);
            if (!input || typeof input !== 'object' || Object.keys(input).some(key => key !== 'step')
                || (input.step !== undefined && !steps.includes(input.step))) throw new OnboardingError('invalid_request');
            deps.openLauncher(input);
            return { success: true };
        } catch { return { success: false }; }
    });
    subscriptions.get(service)?.();
    subscriptions.set(service, service.subscribe(snapshot => deps.broadcast('onboarding-state-changed', snapshot)));
}
