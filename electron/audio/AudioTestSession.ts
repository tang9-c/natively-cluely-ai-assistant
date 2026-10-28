import { randomUUID } from 'crypto';
import type { AudioTestResult, AudioTestState, OnboardingErrorCode } from '../../shared/onboarding';

interface TestCapture {
    start(): void;
    stop?(): Promise<void> | void;
    destroy?(): Promise<void> | void;
    on(event: string, callback: (...args: any[]) => void): unknown;
    removeListener(event: string, callback: (...args: any[]) => void): unknown;
}
export interface AudioTestOwner {
    id: number;
    isDestroyed(): boolean;
    once?(event: 'destroyed', callback: () => void): unknown;
    removeListener?(event: 'destroyed', callback: () => void): unknown;
}
interface AudioTestDependencies {
    isBusy(): boolean;
    requestPermission(): Promise<boolean>;
    createCapture(deviceId?: string): TestCapture;
    onData(data: Buffer): void;
    onState(ownerId: number, state: AudioTestState): void;
}
interface Operation {
    owner: AudioTestOwner;
    operationId: string;
    promise: Promise<AudioTestResult>;
    capture?: TestCapture;
    onDestroyed: () => void;
    onData?: (data: Buffer) => void;
    onError?: () => void;
    errorCode?: OnboardingErrorCode;
}
/** Owns only the existing microphone level test, never recordings or STT. */
export class AudioTestSession {
    private operation?: Operation;
    private cleanup: Promise<void> = Promise.resolve();
    constructor(private readonly deps: AudioTestDependencies) {}
    get isActive(): boolean { return !!this.operation; }

    start(deviceId: string | undefined, owner: AudioTestOwner, operationId: string = randomUUID()): Promise<AudioTestResult> {
        if (typeof operationId !== 'string' || !operationId || operationId.length > 128
            || (deviceId !== undefined && (typeof deviceId !== 'string' || deviceId.length > 1024))) {
            return Promise.resolve(this.failure(operationId, 'invalid_request'));
        }
        if (owner.isDestroyed()) return Promise.resolve(this.failure(operationId, 'cancelled'));
        if (this.operation?.owner.id === owner.id && this.operation.operationId === operationId) return this.operation.promise;
        if (this.deps.isBusy() || (this.operation && this.operation.owner.id !== owner.id)) return Promise.resolve(this.failure(operationId, 'busy'));
        void this.stop(owner.id).catch(() => {});
        const operation: Operation = { owner, operationId, promise: undefined!, onDestroyed: () => { void this.stop(owner.id, operationId).catch(() => {}); } };
        this.operation = operation;
        owner.once?.('destroyed', operation.onDestroyed);
        operation.promise = this.startImpl(operation, deviceId === 'default' ? undefined : deviceId);
        return operation.promise;
    }
    stop(ownerId?: number, operationId?: string): Promise<void> {
        const operation = this.operation;
        if (operation && (ownerId === undefined || ownerId === operation.owner.id)
            && (operationId === undefined || operationId === operation.operationId)) this.close(operation, 'stopped');
        return this.cleanup;
    }
    private valid(operation: Operation): boolean {
        return this.operation === operation && !operation.owner.isDestroyed() && !this.deps.isBusy();
    }
    private async startImpl(operation: Operation, deviceId?: string): Promise<AudioTestResult> {
        try {
            await this.cleanup;
            if (!this.valid(operation)) return this.cancelled(operation);
            if (!await this.deps.requestPermission()) {
                if (!this.valid(operation)) return this.cancelled(operation);
                return this.fail(operation, 'permission_denied');
            }
            if (!this.valid(operation)) return this.cancelled(operation);
            let fallback = false;
            try { this.open(operation, deviceId); }
            catch {
                if (!deviceId || !this.valid(operation)) return this.fail(operation, 'device_missing');
                await this.disposeCapture(operation);
                if (!this.valid(operation)) return this.cancelled(operation);
                fallback = true;
                this.open(operation);
            }
            if (!this.valid(operation)) return this.cancelled(operation);
            this.emit(operation, { operationId: operation.operationId, status: 'running' });
            return { success: true, operationId: operation.operationId, actualDeviceId: fallback || !deviceId ? 'default' : deviceId, usedDefaultFallback: fallback };
        } catch { return this.fail(operation, 'device_missing'); }
    }
    private open(operation: Operation, deviceId?: string): void {
        const capture = this.deps.createCapture(deviceId);
        operation.capture = capture;
        operation.onData = data => { if (this.operation === operation) this.deps.onData(data); };
        operation.onError = () => { if (this.operation === operation) this.fail(operation, 'device_missing'); };
        capture.on('data', operation.onData); capture.on('error', operation.onError);
        capture.start();
    }
    private cancelled(operation: Operation): AudioTestResult {
        if (this.operation === operation) this.close(operation, 'stopped');
        return this.failure(operation.operationId, operation.errorCode ?? 'cancelled');
    }
    private fail(operation: Operation, code: OnboardingErrorCode): AudioTestResult {
        operation.errorCode = code;
        if (this.operation === operation) this.close(operation, 'failed', code);
        return this.failure(operation.operationId, code);
    }
    private close(operation: Operation, status: 'stopped' | 'failed', errorCode?: OnboardingErrorCode): void {
        this.operation = undefined;
        operation.owner.removeListener?.('destroyed', operation.onDestroyed);
        this.cleanup = this.disposeCapture(operation);
        // Avoid unhandled rejection on window destruction, while retaining failed cleanup
        // so the next start/meeting cannot open another capture over an unreleased one.
        void this.cleanup.catch(() => {});
        this.emit(operation, { operationId: operation.operationId, status, ...(errorCode ? { errorCode } : {}) });
    }
    private disposeCapture(operation: Operation): Promise<void> {
        const capture = operation.capture;
        operation.capture = undefined;
        if (capture && operation.onData) capture.removeListener('data', operation.onData);
        const dispose = async () => {
            try { if (capture?.destroy) await capture.destroy(); else await capture?.stop?.(); }
            finally { if (capture && operation.onError) capture.removeListener('error', operation.onError); }
        };
        this.cleanup = this.cleanup.then(dispose);
        return this.cleanup;
    }
    private emit(operation: Operation, state: AudioTestState): void {
        try { this.deps.onState(operation.owner.id, state); } catch { /* Owner may have closed. */ }
    }
    private failure(operationId: string, errorCode: OnboardingErrorCode): AudioTestResult {
        return { success: false, operationId, errorCode, messageKey: `onboarding.${errorCode}` };
    }
}
