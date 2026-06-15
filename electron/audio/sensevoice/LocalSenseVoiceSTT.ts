import { Worker } from 'worker_threads';
import { BaseSTT } from '../BaseSTT';
import { resampleToF32 } from '../whisper/audioResampler';
import { VadProcessor, VadProcessorOptions } from '../whisper/vadProcessor';
import {
  SENSEVOICE_DEFAULT_MODEL_ID,
  type SenseVoiceModelId,
  type SenseVoiceWorkerOutMessage,
} from './types';
import { resolveSenseVoiceModelFiles } from './modelManager';
import { resolveSenseVoiceWorkerPath } from './workerPathResolver';
import { cleanSenseVoiceText } from './textCleaner';
import { isVerboseLogging } from '../../verboseLog';

type SenseVoiceWorkerLike = {
  on(event: 'message', listener: (message: SenseVoiceWorkerOutMessage) => void): SenseVoiceWorkerLike;
  on(event: 'error', listener: (error: Error) => void): SenseVoiceWorkerLike;
  on(event: 'exit', listener: (code: number) => void): SenseVoiceWorkerLike;
  postMessage(message: any, transferList?: any[]): void;
  terminate(): Promise<number> | void;
};

function debugLog(event: string, metadata: Record<string, unknown> = {}): void {
  if (!isVerboseLogging()) return;
  console.log(`[LocalSenseVoiceSTT] ${event}`, metadata);
}

export interface LocalSenseVoiceSTTOptions {
  modelId?: SenseVoiceModelId;
  workerFactory?: () => SenseVoiceWorkerLike;
  modelFiles?: { modelDir: string; modelFile: string; tokensFile: string };
  vadOptions?: VadProcessorOptions;
  numThreads?: number;
}

export class LocalSenseVoiceSTT extends BaseSTT {
  private readonly modelId: SenseVoiceModelId;
  private readonly workerFactory?: () => SenseVoiceWorkerLike;
  private readonly modelFiles?: { modelDir: string; modelFile: string; tokensFile: string };
  private readonly vadOptions?: VadProcessorOptions;
  private readonly numThreads: number;

  private inputSampleRate = 16000;
  private channelLabel = '';
  private vad: VadProcessor | null = null;
  private worker: SenseVoiceWorkerLike | null = null;
  private workerReady = false;
  private taskCounter = 0;
  private pendingAudio: Float32Array[] = [];
  private inFlightTasks = 0;
  private gapFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly GAP_FLUSH_MS = 400;

  constructor(options: LocalSenseVoiceSTTOptions = {}) {
    super();
    this.modelId = options.modelId ?? SENSEVOICE_DEFAULT_MODEL_ID;
    this.workerFactory = options.workerFactory;
    this.modelFiles = options.modelFiles;
    this.vadOptions = options.vadOptions;
    this.numThreads = options.numThreads ?? Math.max(1, Math.min(4, require('os').cpus()?.length ?? 2));
  }

  setSampleRate(rate: number): void {
    this.inputSampleRate = rate;
  }

  setAudioChannelCount(_count: number): void {}

  setRecognitionLanguage(key: string): void {
    this._languageKey = key || 'chinese';
  }

  setCredentials(_path: string): void {}

  setChannel(label: string): void {
    this.channelLabel = (label ?? '').trim();
  }

  start(): void {
    if (this._isActive) return;
    debugLog('start', {
      modelId: this.modelId,
      channel: this.channelLabel || '(unset)',
      inputSampleRate: this.inputSampleRate,
      numThreads: this.numThreads,
    });
    this._isActive = true;
    this.workerReady = false;
    this.pendingAudio = [];
    this.inFlightTasks = 0;
    this.vad = new VadProcessor(this.resolveVadOptions());
    this.spawnWorker();
  }

  stop(): void {
    if (!this._isActive) return;
    debugLog('stop', {
      channel: this.channelLabel || '(unset)',
      pendingAudio: this.pendingAudio.length,
      inFlightTasks: this.inFlightTasks,
      workerReady: this.workerReady,
    });
    this._isActive = false;
    if (this.gapFlushTimer) {
      clearTimeout(this.gapFlushTimer);
      this.gapFlushTimer = null;
    }
    this.finalize();
    this.vad = null;
    const worker = this.worker;
    this.worker = null;
    this.workerReady = false;
    if (worker) {
      void worker.terminate();
    }
  }

  write(chunk: Buffer): void {
    if (!this._isActive || !this.vad) return;
    const f32 = resampleToF32(chunk, this.inputSampleRate);
    const segments = this.vad.push(f32);
    debugLog('write', {
      channel: this.channelLabel || '(unset)',
      chunkBytes: chunk.length,
      sampleCount: f32.length,
      emittedSegments: segments.length,
      pendingAudio: this.pendingAudio.length,
    });
    segments.forEach(segment => this.dispatchFinal(segment.samples));
    this.resetGapFlushTimer();
  }

  notifySpeechEnded(): void {
    debugLog('speech-ended', { channel: this.channelLabel || '(unset)' });
    this.flushVad();
  }

  finalize(): void {
    debugLog('finalize', {
      channel: this.channelLabel || '(unset)',
      pendingAudio: this.pendingAudio.length,
      inFlightTasks: this.inFlightTasks,
    });
    this.flushVad();
  }

  async drainFinals(timeoutMs: number = 5000): Promise<void> {
    if (this._isActive) {
      this.finalize();
    }

    debugLog('drain-start', {
      timeoutMs,
      pendingAudio: this.pendingAudio.length,
      inFlightTasks: this.inFlightTasks,
    });

    if (this.pendingAudio.length === 0 && this.inFlightTasks === 0) return;

    await new Promise<void>((resolve) => {
      const started = Date.now();
      const timer = setInterval(() => {
        const drained = this.pendingAudio.length === 0 && this.inFlightTasks === 0;
        const timedOut = Date.now() - started >= timeoutMs;
        if (drained || timedOut) {
          clearInterval(timer);
          if (timedOut && !drained) {
            console.warn('[LocalSenseVoiceSTT] Timed out draining final transcripts before meeting save');
          }
          debugLog('drain-complete', {
            timedOut,
            pendingAudio: this.pendingAudio.length,
            inFlightTasks: this.inFlightTasks,
          });
          resolve();
        }
      }, 50);
    });
  }

  private resolveVadOptions(): VadProcessorOptions {
    if (this.channelLabel === 'system') {
      return {
        rmsThreshold: 0.004,
        hangoverFrames: 18,
        minSpeechFrames: 3,
        ...this.vadOptions,
      };
    }
    return this.vadOptions ?? {};
  }

  private spawnWorker(): void {
    const worker = this.workerFactory ? this.workerFactory() : new Worker(resolveSenseVoiceWorkerPath());
    this.worker = worker;
    debugLog('worker-spawn', {
      modelId: this.modelId,
      channel: this.channelLabel || '(unset)',
      customWorkerFactory: !!this.workerFactory,
    });

    worker.on('message', (message) => this.handleWorkerMessage(message));
    worker.on('error', (error) => {
      debugLog('worker-error', { message: error.message });
      this.emit('error', error);
      this.pendingAudio = [];
      this.inFlightTasks = 0;
    });
    worker.on('exit', (code) => {
      debugLog('worker-exit', { code, active: this._isActive });
      if (code !== 0 && this._isActive) {
        this.emit('error', new Error(`SenseVoice worker exited with code ${code}`));
      }
    });

    const files = this.modelFiles ?? (this.workerFactory
      ? { modelDir: '', modelFile: '', tokensFile: '' }
      : resolveSenseVoiceModelFiles(this.modelId));
    debugLog('worker-init', {
      modelId: this.modelId,
      modelFileConfigured: !!files.modelFile,
      tokensFileConfigured: !!files.tokensFile,
      numThreads: this.numThreads,
    });
    worker.postMessage({
      type: 'init',
      modelDir: files.modelDir,
      modelFile: files.modelFile,
      tokensFile: files.tokensFile,
      numThreads: this.numThreads,
      verboseLogging: isVerboseLogging(),
    });
  }

  private handleWorkerMessage(message: SenseVoiceWorkerOutMessage): void {
    if (message.type === 'ready') {
      this.workerReady = true;
      debugLog('worker-ready', { pendingAudio: this.pendingAudio.length });
      this.flushPendingAudio();
      return;
    }

    if (message.type === 'result') {
      this.inFlightTasks = Math.max(0, this.inFlightTasks - 1);
      const text = cleanSenseVoiceText(message.text);
      debugLog('worker-result', {
        taskId: message.taskId,
        textLength: text.length,
        pendingAudio: this.pendingAudio.length,
        inFlightTasks: this.inFlightTasks,
      });
      if (text) {
        this.emit('transcript', {
          text,
          isFinal: true,
          confidence: 0.9,
        });
      }
      this.flushPendingAudio();
      return;
    }

    if (message.type === 'error') {
      if (message.taskId) {
        this.inFlightTasks = Math.max(0, this.inFlightTasks - 1);
      } else {
        this.pendingAudio = [];
        this.inFlightTasks = 0;
      }
      debugLog('worker-message-error', {
        taskId: message.taskId || '(init)',
        message: message.message,
        pendingAudio: this.pendingAudio.length,
        inFlightTasks: this.inFlightTasks,
      });
      this.emit('error', new Error(message.message));
      this.flushPendingAudio();
    }
  }

  private flushVad(): void {
    if (!this.vad) return;
    if (this.gapFlushTimer) {
      clearTimeout(this.gapFlushTimer);
      this.gapFlushTimer = null;
    }
    const segments = this.vad.flush();
    debugLog('vad-flush', { emittedSegments: segments.length });
    segments.forEach(segment => this.dispatchFinal(segment.samples));
  }

  private dispatchFinal(samples: Float32Array): void {
    if (samples.length === 0) return;
    debugLog('queue-final', {
      sampleCount: samples.length,
      pendingBefore: this.pendingAudio.length,
      workerReady: this.workerReady,
    });
    this.pendingAudio.push(samples.slice());
    this.flushPendingAudio();
  }

  private flushPendingAudio(): void {
    if (!this.worker || !this.workerReady) return;
    while (this.pendingAudio.length > 0) {
      const samples = this.pendingAudio.shift();
      if (!samples) continue;
      const taskId = `sensevoice-${++this.taskCounter}`;
      this.inFlightTasks++;
      debugLog('dispatch-final', {
        taskId,
        sampleCount: samples.length,
        pendingAudio: this.pendingAudio.length,
        inFlightTasks: this.inFlightTasks,
      });
      this.worker.postMessage(
        {
          type: 'transcribe',
          taskId,
          samples,
          verboseLogging: isVerboseLogging(),
        },
        [samples.buffer],
      );
    }
  }

  private resetGapFlushTimer(): void {
    if (this.gapFlushTimer) clearTimeout(this.gapFlushTimer);
    this.gapFlushTimer = setTimeout(() => {
      this.gapFlushTimer = null;
      if (this._isActive) {
        this.flushVad();
      }
    }, LocalSenseVoiceSTT.GAP_FLUSH_MS);
  }
}
