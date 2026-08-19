import { randomUUID } from 'node:crypto';

import type {
  NativeAudioTranscriptPayload,
  TranscriptBatchFlushReason,
  TranscriptBatchPayload,
} from '../../shared/transcriptIpc';

export interface TranscriptIpcDiagnostics {
  itemCount: number;
  batchCount: number;
  partialCount: number;
  finalCount: number;
  droppedCount: number;
  sentBytes: number;
  maxPendingCount: number;
  averageBatchSize: number;
  waitP50Ms: number;
  waitP95Ms: number;
}

interface QueuedTranscript {
  payload: NativeAudioTranscriptPayload;
  enqueuedAt: number;
}

interface TranscriptIpcBatcherOptions {
  sendBatch: (batch: TranscriptBatchPayload, reason: TranscriptBatchFlushReason) => void;
  flushIntervalMs?: number;
  maxBatchSize?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

const emptyDiagnostics = (): TranscriptIpcDiagnostics => ({
  itemCount: 0,
  batchCount: 0,
  partialCount: 0,
  finalCount: 0,
  droppedCount: 0,
  sentBytes: 0,
  maxPendingCount: 0,
  averageBatchSize: 0,
  waitP50Ms: 0,
  waitP95Ms: 0,
});

const percentile = (values: number[], ratio: number): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
};

export class TranscriptIpcBatcher {
  private readonly queue: QueuedTranscript[] = [];
  private readonly sendBatch: TranscriptIpcBatcherOptions['sendBatch'];
  private readonly flushIntervalMs: number;
  private readonly maxBatchSize: number;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<TranscriptIpcBatcherOptions['setTimer']>;
  private readonly clearTimer: NonNullable<TranscriptIpcBatcherOptions['clearTimer']>;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private diagnostics = emptyDiagnostics();
  private waitSamples: number[] = [];

  constructor(options: TranscriptIpcBatcherOptions) {
    this.sendBatch = options.sendBatch;
    this.flushIntervalMs = options.flushIntervalMs ?? 50;
    this.maxBatchSize = options.maxBatchSize ?? 16;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? setTimeout;
    this.clearTimer = options.clearTimer ?? clearTimeout;
  }

  enqueue(payload: NativeAudioTranscriptPayload): void {
    this.queue.push({ payload, enqueuedAt: this.now() });
    this.diagnostics.itemCount += 1;
    if (payload.final) this.diagnostics.finalCount += 1;
    else this.diagnostics.partialCount += 1;
    this.diagnostics.maxPendingCount = Math.max(
      this.diagnostics.maxPendingCount,
      this.queue.length,
    );

    if (this.queue.length >= this.maxBatchSize) {
      this.flush('max_size');
      return;
    }
    this.ensureTimer();
  }

  flush(reason: TranscriptBatchFlushReason): void {
    this.cancelTimer();
    while (this.queue.length > 0) {
      const queued = this.queue.splice(0, this.maxBatchSize);
      const emittedAt = this.now();
      const batch: TranscriptBatchPayload = {
        batchId: randomUUID(),
        emittedAt,
        items: queued.map(item => item.payload),
      };
      for (const item of queued) {
        this.waitSamples.push(Math.max(0, emittedAt - item.enqueuedAt));
      }
      this.sendBatch(batch, reason);
      this.diagnostics.batchCount += 1;
      this.diagnostics.sentBytes += Buffer.byteLength(JSON.stringify(batch));
    }
  }

  getPendingCount(): number {
    return this.queue.length;
  }

  getDiagnosticsSnapshot(): TranscriptIpcDiagnostics {
    return {
      ...this.diagnostics,
      averageBatchSize: this.diagnostics.batchCount > 0
        ? this.diagnostics.itemCount / this.diagnostics.batchCount
        : 0,
      waitP50Ms: percentile(this.waitSamples, 0.5),
      waitP95Ms: percentile(this.waitSamples, 0.95),
    };
  }

  snapshotAndResetDiagnostics(): TranscriptIpcDiagnostics {
    const snapshot = this.getDiagnosticsSnapshot();
    this.diagnostics = emptyDiagnostics();
    this.waitSamples = [];
    return snapshot;
  }

  dispose(): void {
    this.flush('dispose');
    this.cancelTimer();
  }

  private ensureTimer(): void {
    if (this.timer !== null) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      this.flush('timer');
    }, this.flushIntervalMs);
  }

  private cancelTimer(): void {
    if (this.timer === null) return;
    this.clearTimer(this.timer);
    this.timer = null;
  }
}
