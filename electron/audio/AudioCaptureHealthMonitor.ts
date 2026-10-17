export type AudioCaptureHealthState = 'starting' | 'healthy' | 'recovering' | 'failed';

interface HealthClock {
    now(): number;
    setTimeout(callback: () => void, ms: number): ReturnType<typeof setTimeout>;
    clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

/** Evidence and retry budget only; capture construction remains in main's recovery handler. */
export class AudioCaptureHealthMonitor {
    public state: AudioCaptureHealthState = 'starting';
    public attempts = 0;
    private token = 0;
    private active = false;
    private continuous = false;
    private recovering = false;
    private lastHeartbeatAt = 0;
    private receivedSamples: number | null = null;
    private firstDataAt: number | null = null;
    private lastDataAt: number | null = null;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private readonly clock: HealthClock;

    constructor(private readonly options: {
        clock?: HealthClock;
        onState: (state: AudioCaptureHealthState) => void;
        onFailure: () => void;
    }) {
        this.clock = options.clock ?? { now: Date.now, setTimeout, clearTimeout };
    }

    public bind(): number {
        this.stop();
        this.recovering = false;
        this.receivedSamples = null;
        this.setState(this.attempts > 0 ? 'recovering' : 'starting');
        return this.token;
    }

    public start(token: number, continuous: boolean): void {
        if (token !== this.token || this.state === 'failed') return;
        this.active = true;
        this.lastHeartbeatAt = this.clock.now();
        this.continuous = continuous;
        if (continuous) this.armWatchdog(token);
    }

    public observeHeartbeat(token: number, receivedSamples: number): void {
        if (!this.accepts(token) || !Number.isSafeInteger(receivedSamples) || receivedSamples < 0) return;
        this.continuous = true;
        if (this.receivedSamples === null ? receivedSamples > 0 : receivedSamples !== this.receivedSamples) {
            this.lastHeartbeatAt = this.clock.now();
        }
        this.receivedSamples = receivedSamples;
        this.armWatchdog(token);
    }

    public recordData(token: number, byteLength: number): void {
        if (!this.accepts(token) || byteLength < 2 || byteLength % 2 !== 0) return;
        const now = this.clock.now();
        if (this.lastDataAt === null || now - this.lastDataAt > 1000) this.firstDataAt = now;
        this.lastDataAt = now;
        this.setState('healthy');
        if (this.firstDataAt !== null && now - this.firstDataAt >= 5000) this.attempts = 0;
    }

    public beginRecovery(token: number, permanent = false): boolean {
        if (token !== this.token || this.state === 'failed' || this.recovering) return false;
        this.clearTimer();
        this.active = false;
        this.firstDataAt = this.lastDataAt = null;
        if (permanent || this.attempts >= 3) {
            this.setState('failed');
            return false;
        }
        this.recovering = true;
        this.attempts++;
        this.setState('recovering');
        return true;
    }

    public get isCapturing(): boolean { return this.active && this.state !== 'failed'; }

    public resetSession(): void {
        this.stop();
        this.attempts = 0;
        this.recovering = false;
        this.setState('starting');
    }

    public isCurrent(token: number): boolean { return token === this.token; }

    public stop(): void {
        this.clearTimer();
        this.active = false;
        this.firstDataAt = this.lastDataAt = null;
        this.token++;
    }

    private accepts(token: number): boolean { return token === this.token && this.active && this.state !== 'failed'; }
    private setState(state: AudioCaptureHealthState): void {
        if (state === this.state) return;
        this.state = state;
        this.options.onState(state);
    }
    private armWatchdog(token: number): void {
        this.clearTimer();
        this.timer = this.clock.setTimeout(() => {
            this.timer = null;
            if (!this.accepts(token)) return;
            this.setState('recovering');
            this.options.onFailure();
        }, Math.max(0, 8000 - (this.clock.now() - this.lastHeartbeatAt)));
    }
    private clearTimer(): void {
        if (this.timer !== null) this.clock.clearTimeout(this.timer);
        this.timer = null;
    }
}
