import { EventEmitter } from 'events';
import { Worker } from 'worker_threads';

export type LocalSttChannelId = 'mic' | 'system';

export interface LocalSttWorkerConfig {
  provider: 'whisper' | 'sensevoice';
  modelId: string;
  executionProviders: string[];
  dtype: string | Record<string, string>;
  sessionConfig: Record<string, unknown>;
  workerPath: string;
  initMessage: Record<string, unknown>;
  audioField: 'audio' | 'samples';
}

export interface LocalSttTranscribeMetadata {
  taskId: string;
  prompt?: string;
  [key: string]: unknown;
}

export interface LocalSttWorkerResult {
  type: 'result' | 'partial';
  taskId: string;
  text: string;
  channelId: LocalSttChannelId;
}

type WorkerLike = EventEmitter & {
  postMessage(message: unknown, transferList?: readonly any[]): void;
  terminate(): Promise<number> | number | void;
};

interface PoolOptions {
  workerFactory?: (config: LocalSttWorkerConfig) => WorkerLike;
}

interface QueueTask {
  requestId: string;
  lease: LocalSttWorkerLease;
  audio: Float32Array;
  metadata: LocalSttTranscribeMetadata;
  resolve: (result: LocalSttWorkerResult) => void;
  reject: (error: Error) => void;
}

interface PoolEntry {
  key: string;
  config: LocalSttWorkerConfig;
  worker: WorkerLike;
  ready: boolean;
  readyMessage: Record<string, unknown> | null;
  readyError: Error | null;
  queue: QueueTask[];
  activeTask: QueueTask | null;
  currentPrompt: string | null;
  leases: Set<LocalSttWorkerLease>;
  terminating: boolean;
}

export class LocalSttWorkerError extends Error {
  readonly code: 'worker_crashed' | 'worker_released' | 'inference_failed';

  constructor(code: 'worker_crashed' | 'worker_released' | 'inference_failed', message: string) {
    super(message);
    this.name = 'LocalSttWorkerError';
    this.code = code;
  }
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function workerKey(config: LocalSttWorkerConfig): string {
  return JSON.stringify(stableValue({
    provider: config.provider,
    modelId: config.modelId,
    executionProviders: config.executionProviders,
    dtype: config.dtype,
    sessionConfig: config.sessionConfig,
  }));
}

export class LocalSttWorkerLease extends EventEmitter {
  private released = false;
  private pendingTasks = 0;
  private flushWaiters: Array<() => void> = [];
  private prompt = '';

  constructor(
    private readonly pool: LocalSttWorkerPool,
    readonly entry: PoolEntry,
    readonly channelId: LocalSttChannelId,
  ) {
    super();
  }

  transcribe(audio: Float32Array, metadata: LocalSttTranscribeMetadata): Promise<LocalSttWorkerResult> {
    if (this.released) {
      return Promise.reject(new LocalSttWorkerError('worker_released', 'Local STT worker lease has been released'));
    }
    this.pendingTasks += 1;
    return this.pool.enqueue(this, audio, metadata).finally(() => {
      this.pendingTasks = Math.max(0, this.pendingTasks - 1);
      if (this.pendingTasks === 0) this.resolveFlushWaiters();
    });
  }

  get isReady(): boolean {
    return this.entry.ready;
  }

  postMessage(message: Record<string, any>, _transferList?: readonly any[]): void {
    if (message.type === 'setPrompt') {
      this.prompt = String(message.prompt ?? '');
      return;
    }
    if (message.type !== 'transcribe') return;
    const audio = message.audio ?? message.samples;
    const { type: _type, audio: _audio, samples: _samples, ...metadata } = message;
    void this.transcribe(audio, {
      ...metadata,
      taskId: String(metadata.taskId),
      prompt: this.prompt,
    })
      .then(result => this.emit('message', {
        type: result.type,
        taskId: result.taskId,
        text: result.text,
      }))
      .catch(error => {
        if (error instanceof LocalSttWorkerError && error.code === 'worker_crashed') return;
        this.emit('message', {
          type: 'error',
          taskId: metadata.taskId,
          message: error instanceof Error ? error.message : String(error),
        });
      });
  }

  terminate(): Promise<void> {
    return this.release();
  }

  async flush(): Promise<void> {
    if (this.pendingTasks === 0) return;
    await new Promise<void>(resolve => this.flushWaiters.push(resolve));
  }

  async release(): Promise<void> {
    if (this.released) return;
    this.released = true;
    if (this.pendingTasks > 0) await this.flush();
    this.pool.releaseLease(this);
    this.removeAllListeners();
  }

  private resolveFlushWaiters(): void {
    const waiters = this.flushWaiters.splice(0);
    waiters.forEach(resolve => resolve());
  }
}

export class LocalSttWorkerPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly workerFactory: (config: LocalSttWorkerConfig) => WorkerLike;
  private requestCounter = 0;

  constructor(options: PoolOptions = {}) {
    this.workerFactory = options.workerFactory ?? (config => new Worker(config.workerPath) as WorkerLike);
  }

  acquire(config: LocalSttWorkerConfig, channelId: LocalSttChannelId): LocalSttWorkerLease {
    const key = workerKey(config);
    let entry = this.entries.get(key);
    if (!entry) {
      entry = this.createEntry(key, config);
      this.entries.set(key, entry);
    }
    const lease = new LocalSttWorkerLease(this, entry, channelId);
    entry.leases.add(lease);
    if (entry.ready) queueMicrotask(() => lease.emit('message', entry!.readyMessage ?? { type: 'ready' }));
    return lease;
  }

  enqueue(
    lease: LocalSttWorkerLease,
    audio: Float32Array,
    metadata: LocalSttTranscribeMetadata,
  ): Promise<LocalSttWorkerResult> {
    const entry = lease.entry;
    if (entry.readyError) return Promise.reject(entry.readyError);
    return new Promise((resolve, reject) => {
      entry.queue.push({
        requestId: `local-stt-${++this.requestCounter}`,
        lease,
        audio,
        metadata: { ...metadata },
        resolve,
        reject,
      });
      this.pump(entry);
    });
  }

  releaseLease(lease: LocalSttWorkerLease): void {
    const entry = lease.entry;
    entry.leases.delete(lease);
    this.terminateIfIdle(entry);
  }

  private createEntry(key: string, config: LocalSttWorkerConfig): PoolEntry {
    const worker = this.workerFactory(config);
    const entry: PoolEntry = {
      key,
      config,
      worker,
      ready: false,
      readyMessage: null,
      readyError: null,
      queue: [],
      activeTask: null,
      currentPrompt: null,
      leases: new Set(),
      terminating: false,
    };
    worker.on('message', message => this.handleMessage(entry!, message as Record<string, unknown>));
    worker.on('error', error => this.failEntry(entry!, error));
    worker.on('exit', code => {
      if (!entry!.terminating && code !== 0) {
        this.failEntry(entry!, new Error(`Local STT worker exited with code ${code}`));
      }
    });
    worker.postMessage(config.initMessage);
    return entry;
  }

  private handleMessage(entry: PoolEntry, message: Record<string, unknown>): void {
    if (message.type === 'ready') {
      entry.ready = true;
      entry.readyMessage = message;
      for (const lease of entry.leases) lease.emit('message', message);
      this.pump(entry);
      return;
    }
    if (message.type === 'error' && !message.taskId) {
      this.failEntry(entry, new Error(String(message.message ?? 'Local STT worker initialization failed')));
      return;
    }
    const task = entry.activeTask;
    if (!task || message.taskId !== task.requestId) return;
    entry.activeTask = null;
    if (message.type === 'error') {
      task.reject(new LocalSttWorkerError('inference_failed', String(message.message ?? 'Local STT inference failed')));
    } else if (message.type === 'result' || message.type === 'partial') {
      task.resolve({
        type: message.type,
        taskId: task.metadata.taskId,
        text: String(message.text ?? ''),
        channelId: task.lease.channelId,
      });
    }
    this.pump(entry);
    this.terminateIfIdle(entry);
  }

  private pump(entry: PoolEntry): void {
    if (!entry.ready || entry.readyError || entry.activeTask || entry.queue.length === 0) return;
    const task = entry.queue.shift()!;
    entry.activeTask = task;
    if (typeof task.metadata.prompt === 'string' && task.metadata.prompt !== entry.currentPrompt) {
      entry.worker.postMessage({ type: 'setPrompt', prompt: task.metadata.prompt });
      entry.currentPrompt = task.metadata.prompt;
    }
    const { taskId: _taskId, prompt: _prompt, ...metadata } = task.metadata;
    const samples = task.audio;
    entry.worker.postMessage({
      type: 'transcribe',
      ...metadata,
      taskId: task.requestId,
      [entry.config.audioField]: samples,
    }, [samples.buffer]);
  }

  private failEntry(entry: PoolEntry, cause: Error): void {
    if (entry.readyError) return;
    const error = new LocalSttWorkerError('worker_crashed', cause.message);
    entry.readyError = error;
    entry.ready = false;
    const tasks = [entry.activeTask, ...entry.queue].filter((task): task is QueueTask => task !== null);
    entry.activeTask = null;
    entry.queue = [];
    tasks.forEach(task => task.reject(error));
    for (const lease of entry.leases) {
      if (lease.listenerCount('error') > 0) lease.emit('error', error);
      else lease.emit('workerError', error);
    }
    this.terminateIfIdle(entry);
  }

  private terminateIfIdle(entry: PoolEntry): void {
    if (entry.leases.size > 0 || entry.activeTask || entry.queue.length > 0 || entry.terminating) return;
    entry.terminating = true;
    this.entries.delete(entry.key);
    void entry.worker.terminate();
  }
}

export const localSttWorkerPool = new LocalSttWorkerPool();
