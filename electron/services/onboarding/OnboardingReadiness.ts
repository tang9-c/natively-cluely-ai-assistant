import type { OnboardingCheck, OnboardingDeviceSelection, OnboardingSnapshot } from '../../../shared/onboarding';
interface PermissionSnapshot { platform: string; microphone: string; screen: string; systemAudioHealth?: { effectiveGranted: boolean } }
/** Passive OS/device checks only: no permission request, model load or network probe. */
export function createOnboardingReadinessReader(deps: {
    readPermissions(): Promise<PermissionSnapshot>;
    isPackaged(): boolean;
    inputDevices(): { id: string; name: string }[];
    outputDevices(): { id: string; name: string }[];
    speechCheck(): OnboardingCheck;
}): (selection?: OnboardingDeviceSelection) => Promise<OnboardingSnapshot['checks']> {
    return async (selection = {}) => {
        const [permissionResult, inputResult, outputResult, speechResult] = await Promise.allSettled([
            deps.readPermissions(), Promise.resolve().then(deps.inputDevices), Promise.resolve().then(deps.outputDevices), Promise.resolve().then(deps.speechCheck),
        ]);
        const permissions = permissionResult.status === 'fulfilled' ? permissionResult.value : { platform: 'unknown', microphone: 'unknown', screen: 'unknown' };
        const inputs = inputResult.status === 'fulfilled' ? inputResult.value : [], outputs = outputResult.status === 'fulfilled' ? outputResult.value : [];
        const speech: OnboardingCheck = speechResult.status === 'fulfilled' ? speechResult.value : { status: 'failed', errorCode: 'storage_failed', messageKey: 'onboarding.configuration_unavailable' };
        const blocked = ['denied', 'restricted'].includes(permissions.microphone);
        const microphone: OnboardingCheck = permissionResult.status === 'rejected' ? { status: 'failed', errorCode: 'unsupported_check', evidenceSource: 'unavailable' } : blocked
            ? { status: 'failed', errorCode: 'permission_denied', evidenceSource: 'system' }
            : permissions.platform === 'darwin' && deps.isPackaged() && permissions.microphone === 'granted'
                ? { status: 'verified', evidenceSource: 'system' } : { status: 'pending_runtime', evidenceSource: 'unavailable' };
        const inputValid = inputs.length > 0 && (!selection.inputDeviceId || selection.inputDeviceId === 'default' || inputs.some(device => device.id === selection.inputDeviceId));
        const outputValid = outputs.length > 0 && (!selection.outputDeviceId || selection.outputDeviceId === 'default'
            || (selection.outputDeviceId === 'sck' && permissions.platform === 'darwin') || outputs.some(device => device.id === selection.outputDeviceId));
        const systemAudio: OnboardingCheck = permissionResult.status === 'rejected' ? { status: 'failed', errorCode: 'unsupported_check', evidenceSource: 'unavailable' } : !outputValid ? { status: 'failed', errorCode: 'device_missing', evidenceSource: 'system' }
            : permissions.platform === 'darwin' && permissions.screen !== 'granted'
                ? { status: 'limited', errorCode: 'permission_denied', evidenceSource: 'system' }
                : { status: 'pending_runtime', evidenceSource: permissions.platform === 'darwin' && deps.isPackaged() ? 'system' : 'unavailable' };
        return { microphone, inputDevice: inputValid ? { status: 'verified', evidenceSource: 'system' }
            : { status: 'missing', errorCode: 'device_missing', evidenceSource: 'system' },
            systemAudio, stt: speech, ai: { status: 'missing' } };
    };
}
