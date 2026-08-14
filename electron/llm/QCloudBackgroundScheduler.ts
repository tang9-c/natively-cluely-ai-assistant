type PendingTask = {
  start: () => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort?: () => void;
};

export class QCloudBackgroundScheduler {
  private active = 0;
  private readonly queue: PendingTask[] = [];

  constructor(
    private readonly maxConcurrency = 2,
    private readonly maxQueueDepth = 20,
  ) {
    if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
      throw new Error('maxConcurrency must be a positive integer');
    }
  }

  run<T>(task: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) {
      return Promise.reject(signal.reason instanceof Error ? signal.reason : new Error('Background task aborted'));
    }
    if (this.queue.length >= this.maxQueueDepth) {
      return Promise.reject(new Error(`QCLOUD background queue full (${this.maxQueueDepth})`));
    }

    return new Promise<T>((resolve, reject) => {
      const pending: PendingTask = {
        signal,
        reject,
        start: () => {
          if (signal && pending.onAbort) signal.removeEventListener('abort', pending.onAbort);
          this.active += 1;
          task().then(resolve, reject).finally(() => {
            this.active -= 1;
            this.drain();
          });
        },
      };
      if (signal) {
        pending.onAbort = () => {
          const index = this.queue.indexOf(pending);
          if (index >= 0) this.queue.splice(index, 1);
          reject(signal.reason instanceof Error ? signal.reason : new Error('Background task aborted'));
        };
        signal.addEventListener('abort', pending.onAbort, { once: true });
      }
      this.queue.push(pending);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.maxConcurrency && this.queue.length > 0) {
      const pending = this.queue.shift()!;
      if (pending.signal?.aborted) {
        pending.reject(
          pending.signal.reason instanceof Error
            ? pending.signal.reason
            : new Error('Background task aborted'),
        );
        continue;
      }
      pending.start();
    }
  }
}

export const qcloudBackgroundScheduler = new QCloudBackgroundScheduler(2);
