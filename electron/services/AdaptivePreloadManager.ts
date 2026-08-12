export type AdaptiveLocalSttProvider = 'local-sensevoice' | 'local-whisper' | string;

export interface LocalSttPreloadSelection {
  provider: AdaptiveLocalSttProvider;
  modelId?: string;
  modelDownloaded: boolean;
}

interface AdaptivePreloadManagerOptions {
  preload: (selection: LocalSttPreloadSelection) => Promise<void> | void;
  release: () => Promise<void> | void;
  isHeavyWorkActive?: () => boolean;
  setTimeout?: (callback: () => void, delayMs: number) => any;
  clearTimeout?: (handle: any) => void;
  heavyWorkRetryMs?: number;
  idleReleaseDelayMs?: number;
}

const DEFAULT_HEAVY_WORK_RETRY_MS = 5_000;
export const DEFAULT_IDLE_RELEASE_DELAY_MS = 5 * 60 * 1_000;

function isPreloadable(selection: LocalSttPreloadSelection | null): selection is LocalSttPreloadSelection {
  return Boolean(
    selection
    && selection.modelDownloaded
    && selection.modelId
    && (selection.provider === 'local-sensevoice' || selection.provider === 'local-whisper'),
  );
}

function selectionKey(selection: LocalSttPreloadSelection): string {
  return `${selection.provider}:${selection.modelId}`;
}

export class AdaptivePreloadManager {
  private readonly preload: AdaptivePreloadManagerOptions['preload'];
  private readonly release: AdaptivePreloadManagerOptions['release'];
  private readonly isHeavyWorkActive: () => boolean;
  private readonly scheduleTimer: (callback: () => void, delayMs: number) => any;
  private readonly cancelTimer: (handle: any) => void;
  private readonly heavyWorkRetryMs: number;
  private readonly idleReleaseDelayMs: number;

  private selection: LocalSttPreloadSelection | null = null;
  private warmSelectionKey: string | null = null;
  private preloadTimer: any = null;
  private releaseTimer: any = null;
  private preloadInFlight: Promise<void> | null = null;
  private meetingActive = false;
  private disposed = false;

  constructor(options: AdaptivePreloadManagerOptions) {
    this.preload = options.preload;
    this.release = options.release;
    this.isHeavyWorkActive = options.isHeavyWorkActive ?? (() => false);
    this.scheduleTimer = options.setTimeout ?? ((callback, delayMs) => setTimeout(callback, delayMs));
    this.cancelTimer = options.clearTimeout ?? (handle => clearTimeout(handle));
    this.heavyWorkRetryMs = options.heavyWorkRetryMs ?? DEFAULT_HEAVY_WORK_RETRY_MS;
    this.idleReleaseDelayMs = options.idleReleaseDelayMs ?? DEFAULT_IDLE_RELEASE_DELAY_MS;
  }

  scheduleLocalSttPreload(selection: LocalSttPreloadSelection): void {
    if (this.disposed) return;
    this.selection = { ...selection };
    this.cancelPreloadTimer();
    if (!isPreloadable(this.selection)) {
      if (this.warmSelectionKey) void this.releaseResources();
      return;
    }
    if (this.warmSelectionKey && this.warmSelectionKey !== selectionKey(this.selection)) {
      void this.releaseResources();
    }
  }

  notifyMeetingStarted(): void {
    if (this.disposed) return;
    this.meetingActive = true;
    this.cancelPreloadTimer();
    this.cancelReleaseTimer();
  }

  notifyMeetingStopped(): void {
    if (this.disposed) return;
    this.meetingActive = false;
    if (isPreloadable(this.selection) && this.warmSelectionKey !== selectionKey(this.selection)) {
      this.cancelPreloadTimer();
      this.schedulePreload(0);
    }
    this.cancelReleaseTimer();
    this.releaseTimer = this.scheduleTimer(() => {
      this.releaseTimer = null;
      void this.releaseResources();
    }, this.idleReleaseDelayMs);
  }

  notifyPreloadedResourceInvalidated(): void {
    if (this.disposed) return;
    this.warmSelectionKey = null;
    if (!this.meetingActive && isPreloadable(this.selection)) {
      this.cancelPreloadTimer();
      this.schedulePreload(this.heavyWorkRetryMs);
    }
  }

  async disposeIdleResources(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelPreloadTimer();
    this.cancelReleaseTimer();
    await this.releaseResources();
  }

  private schedulePreload(delayMs: number): void {
    this.preloadTimer = this.scheduleTimer(() => {
      this.preloadTimer = null;
      if (this.disposed || this.meetingActive || !isPreloadable(this.selection)) return;
      if (this.isHeavyWorkActive()) {
        this.schedulePreload(this.heavyWorkRetryMs);
        return;
      }
      void this.ensurePreloaded(this.selection).catch(() => {});
    }, delayMs);
  }

  private ensurePreloaded(selection: LocalSttPreloadSelection): Promise<void> {
    const key = selectionKey(selection);
    if (this.warmSelectionKey === key) return Promise.resolve();
    if (this.preloadInFlight) return this.preloadInFlight;
    this.preloadInFlight = (async () => {
      if (this.warmSelectionKey && this.warmSelectionKey !== key) {
        await this.release();
        this.warmSelectionKey = null;
      }
      this.warmSelectionKey = key;
      try {
        await this.preload(selection);
      } catch (error) {
        if (this.warmSelectionKey === key) this.warmSelectionKey = null;
        throw error;
      }
    })().finally(() => {
      this.preloadInFlight = null;
      if (
        !this.disposed
        && !this.meetingActive
        && isPreloadable(this.selection)
        && this.warmSelectionKey !== selectionKey(this.selection)
      ) {
        this.schedulePreload(0);
      }
    });
    return this.preloadInFlight;
  }

  private async releaseResources(): Promise<void> {
    if (this.preloadInFlight) await this.preloadInFlight.catch(() => {});
    if (!this.warmSelectionKey) return;
    await this.release();
    this.warmSelectionKey = null;
  }

  private cancelPreloadTimer(): void {
    if (this.preloadTimer === null) return;
    this.cancelTimer(this.preloadTimer);
    this.preloadTimer = null;
  }

  private cancelReleaseTimer(): void {
    if (this.releaseTimer === null) return;
    this.cancelTimer(this.releaseTimer);
    this.releaseTimer = null;
  }
}
