import { BaseSTT, type TranscriptSegment } from '../BaseSTT';
import {
  LocalSttWorkerPool,
  localSttWorkerPool,
  type LocalSttWorkerConfig,
  type LocalSttWorkerLease,
} from '../LocalSttWorkerPool';
import { resampleToF32 } from '../whisper/audioResampler';
import { VadProcessor, VadProcessorOptions } from '../whisper/vadProcessor';
import {
  SENSEVOICE_DEFAULT_MODEL_ID,
  type SenseVoiceModelId,
  type SenseVoiceTermCorrectionConfig,
  type SenseVoiceWorkerOutMessage,
} from './types';
import { resolveLocalSttProvider, type LocalSttProviderPlan } from '../hardwareProviderPolicy';
import { resolveSenseVoiceModelFiles } from './modelManager';
import { resolveSenseVoiceWorkerPath } from './workerPathResolver';
import { parseSenseVoiceOutput, shouldDropSenseVoiceHallucination } from './textCleaner';
import { applySenseVoiceTermCorrection } from './termCorrection';
import { isVerboseLogging } from '../../verboseLog';

type SenseVoiceWorkerLike = {
  on(event: 'message', listener: (message: SenseVoiceWorkerOutMessage) => void): SenseVoiceWorkerLike;
  on(event: 'error', listener: (error: Error) => void): SenseVoiceWorkerLike;
  on(event: 'exit', listener: (code: number) => void): SenseVoiceWorkerLike;
  postMessage(message: any, transferList?: any[]): void;
  terminate(): Promise<number> | void;
};

type PendingAudioSegment = {
  samples: Float32Array;
  sourceSegmentCount: number;
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
  termCorrection?: SenseVoiceTermCorrectionConfig;
  numThreads?: number;
  providerPlan?: LocalSttProviderPlan;
}

export function getDefaultSenseVoiceNumThreads(): number {
  return Math.max(1, Math.min(4, require('os').cpus()?.length ?? 2));
}

export function createSenseVoiceWorkerConfig(options: {
  modelId?: SenseVoiceModelId;
  modelFiles?: { modelDir: string; modelFile: string; tokensFile: string };
  numThreads?: number;
  providerPlan?: LocalSttProviderPlan;
} = {}): LocalSttWorkerConfig {
  const modelId = options.modelId ?? SENSEVOICE_DEFAULT_MODEL_ID;
  const files = options.modelFiles ?? resolveSenseVoiceModelFiles(modelId);
  const numThreads = options.numThreads ?? getDefaultSenseVoiceNumThreads();
  const providerPlan = options.providerPlan
    ?? resolveLocalSttProvider(process.platform, process.arch, 'sensevoice');
  const executionProviders: string[] = [...providerPlan.requestedProviders];
  if (providerPlan.fallbackProvider) executionProviders.push(providerPlan.fallbackProvider);
  return {
    provider: 'sensevoice',
    modelId,
    executionProviders,
    dtype: 'fp32',
    sessionConfig: {
      modelDir: files.modelDir,
      modelFile: files.modelFile,
      tokensFile: files.tokensFile,
      numThreads,
    },
    workerPath: resolveSenseVoiceWorkerPath(),
    initMessage: {
      type: 'init',
      modelDir: files.modelDir,
      modelFile: files.modelFile,
      tokensFile: files.tokensFile,
      numThreads,
      requestedProviders: providerPlan.requestedProviders,
      fallbackProvider: providerPlan.fallbackProvider,
      verboseLogging: isVerboseLogging(),
    },
    audioField: 'samples',
  };
}

export class LocalSenseVoiceSTT extends BaseSTT {
  private readonly modelId: SenseVoiceModelId;
  private readonly workerFactory?: () => SenseVoiceWorkerLike;
  private readonly modelFiles?: { modelDir: string; modelFile: string; tokensFile: string };
  private readonly vadOptions?: VadProcessorOptions;
  private readonly termCorrection?: SenseVoiceTermCorrectionConfig;
  private readonly numThreads: number;
  private readonly providerPlan?: LocalSttProviderPlan;
  private hardwareDiagnostics: {
    providerRequested?: string;
    providerActual?: string;
    fallbackReason?: string | null;
    initializationMs?: number;
  } = {};
  private readonly workerPool: LocalSttWorkerPool;

  private inputSampleRate = 16000;
  private channelLabel = '';
  private vad: VadProcessor | null = null;
  private worker: LocalSttWorkerLease | null = null;
  private workerReady = false;
  private taskCounter = 0;
  private pendingAudio: PendingAudioSegment[] = [];
  private pendingAudioByTaskId = new Map<string, PendingAudioSegment>();
  private completedTranscripts = new Map<number, TranscriptSegment | null>();
  private nextTranscriptTaskNumber = 1;
  private inFlightTasks = 0;
  private inFlightAnnotations = 0;
  private gapFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private speechEndedFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private static readonly MAX_PENDING_AUDIO_SEGMENTS = 8;
  private static readonly MAX_IN_FLIGHT_TASKS = 1;
  private static readonly MAX_CONCURRENT_RESULT_TASKS = 2;
  private static readonly GAP_FLUSH_MS = 1800;
  private static readonly SPEECH_ENDED_FLUSH_DEBOUNCE_MS = 800;

  constructor(options: LocalSenseVoiceSTTOptions = {}) {
    super();
    this.modelId = options.modelId ?? SENSEVOICE_DEFAULT_MODEL_ID;
    this.workerFactory = options.workerFactory;
    this.modelFiles = options.modelFiles;
    this.vadOptions = options.vadOptions;
    this.termCorrection = options.termCorrection;
    this.numThreads = options.numThreads ?? getDefaultSenseVoiceNumThreads();
    this.providerPlan = options.providerPlan;
    this.workerPool = this.workerFactory
      ? new LocalSttWorkerPool({ workerFactory: () => this.workerFactory!() as any })
      : localSttWorkerPool;
  }

  getHardwareDiagnostics(): Readonly<typeof this.hardwareDiagnostics> {
    return { ...this.hardwareDiagnostics };
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
      providerPlan: this.providerPlan,
    });
    this._isActive = true;
    this.hardwareDiagnostics = {};
    this.workerReady = false;
    this.pendingAudio = [];
    this.pendingAudioByTaskId.clear();
    this.completedTranscripts.clear();
    this.nextTranscriptTaskNumber = this.taskCounter + 1;
    this.inFlightTasks = 0;
    this.inFlightAnnotations = 0;
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
    this.cancelSpeechEndedFlushTimer();
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
    if (!this._isActive || !this.vad) return;
    this.resetSpeechEndedFlushTimer();
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

    if (
      this.pendingAudio.length === 0
      && this.inFlightTasks === 0
      && this.inFlightAnnotations === 0
      && this.completedTranscripts.size === 0
    ) return;

    await new Promise<void>((resolve) => {
      const started = Date.now();
      let warned = false;
      const timer = setInterval(() => {
        const drained = this.pendingAudio.length === 0
          && this.inFlightTasks === 0
          && this.inFlightAnnotations === 0
          && this.completedTranscripts.size === 0;
        const timedOut = Date.now() - started >= timeoutMs;
        if (timedOut && !warned && !drained) {
          warned = true;
          console.warn('[LocalSenseVoiceSTT] Final transcript drain exceeded warning threshold; continuing until all finals are delivered');
        }
        if (drained) {
          clearInterval(timer);
          debugLog('drain-complete', {
            timedOut,
            pendingAudio: this.pendingAudio.length,
            inFlightTasks: this.inFlightTasks,
            inFlightAnnotations: this.inFlightAnnotations,
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
        hangoverFrames: 30,
        minSpeechFrames: 4,
        ...this.vadOptions,
      };
    }
    return {
      hangoverFrames: 30,
      minSpeechFrames: 4,
      ...this.vadOptions,
    };
  }

  private spawnWorker(): void {
    const files = this.modelFiles ?? (this.workerFactory
      ? { modelDir: '', modelFile: '', tokensFile: '' }
      : resolveSenseVoiceModelFiles(this.modelId));
    const worker = this.workerPool.acquire(createSenseVoiceWorkerConfig({
      modelId: this.modelId,
      modelFiles: files,
      numThreads: this.numThreads,
      providerPlan: this.providerPlan,
    }), this.channelLabel === 'system' ? 'system' : 'mic');
    this.worker = worker;
    debugLog('worker-spawn', {
      modelId: this.modelId,
      channel: this.channelLabel || '(unset)',
      customWorkerFactory: !!this.workerFactory,
    });

    worker.on('message', (message) => {
      void this.handleWorkerMessage(message);
    });
    worker.on('error', (error) => {
      debugLog('worker-error', { message: error.message });
      this.emit('error', error);
      this.pendingAudio = [];
      this.inFlightTasks = 0;
      this.inFlightAnnotations = 0;
    });
    worker.on('exit', (code) => {
      debugLog('worker-exit', { code, active: this._isActive });
      if (code !== 0 && this._isActive) {
        this.emit('error', new Error(`SenseVoice worker exited with code ${code}`));
      }
    });

    debugLog('worker-init', {
      modelId: this.modelId,
      modelFileConfigured: !!files.modelFile,
      tokensFileConfigured: !!files.tokensFile,
      numThreads: this.numThreads,
    });
  }

  private async handleWorkerMessage(message: SenseVoiceWorkerOutMessage): Promise<void> {
    if (message.type === 'ready') {
      this.hardwareDiagnostics = {
        providerRequested: message.providerRequested,
        providerActual: message.providerActual,
        fallbackReason: message.fallbackReason,
        initializationMs: message.initializationMs,
      };
      this.workerReady = true;
      debugLog('worker-ready', { pendingAudio: this.pendingAudio.length });
      this.flushPendingAudio();
      return;
    }

    if (message.type === 'result') {
      const pendingTask = this.pendingAudioByTaskId.get(message.taskId);
      if (!pendingTask) {
        debugLog('duplicate-or-stale-result', { taskId: message.taskId });
        return;
      }
      this.inFlightTasks = Math.max(0, this.inFlightTasks - 1);
      const parsed = parseSenseVoiceOutput(message.text);
      const text = this.applyTermCorrection(parsed.text);
      debugLog('worker-result', {
        taskId: message.taskId,
        textLength: text.length,
        emotion: parsed.emotion,
        pendingAudio: this.pendingAudio.length,
        inFlightTasks: this.inFlightTasks,
      });
      if (text) {
        if (shouldDropSenseVoiceHallucination({ ...parsed, text }, { recognitionLanguageKey: this._languageKey })) {
          debugLog('drop-hallucination', {
            taskId: message.taskId,
            language: parsed.language,
            textLength: text.length,
          });
          this.pendingAudioByTaskId.delete(message.taskId);
          this.completeTranscriptTask(message.taskId, null);
          this.flushPendingAudio();
          return;
        }
        this.inFlightAnnotations += 1;
        this.flushPendingAudio();
        let segment: TranscriptSegment | null = null;
        try {
          const speakerVerification = await this.annotateSpeaker(message.taskId);
          segment = {
            text,
            isFinal: true,
            confidence: 0.9,
            ...(speakerVerification ? { speakerVerification } : {}),
            ...(parsed.emotion ? { emotion: parsed.emotion, emotionSource: 'sensevoice' as const } : {}),
            ...(pendingTask.sourceSegmentCount > 1 ? {
              coalescedFromCount: pendingTask.sourceSegmentCount,
              coalescedProvider: 'local_vad' as const,
            } : {}),
          };
        } catch (error) {
          this.emit('error', error instanceof Error ? error : new Error(String(error)));
        } finally {
          this.inFlightAnnotations = Math.max(0, this.inFlightAnnotations - 1);
          this.completeTranscriptTask(message.taskId, segment);
          this.flushPendingAudio();
        }
      } else {
        this.pendingAudioByTaskId.delete(message.taskId);
        this.completeTranscriptTask(message.taskId, null);
        this.flushPendingAudio();
      }
      return;
    }

    if (message.type === 'error') {
      if (message.taskId) {
        this.inFlightTasks = Math.max(0, this.inFlightTasks - 1);
        this.pendingAudioByTaskId.delete(message.taskId);
        this.completeTranscriptTask(message.taskId, null);
      } else {
        this.pendingAudio = [];
        this.pendingAudioByTaskId.clear();
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

  private completeTranscriptTask(taskId: string, segment: TranscriptSegment | null): void {
    const taskNumber = Number(taskId.slice('sensevoice-'.length));
    if (!Number.isInteger(taskNumber) || taskNumber < this.nextTranscriptTaskNumber) return;
    this.completedTranscripts.set(taskNumber, segment);
    while (this.completedTranscripts.has(this.nextTranscriptTaskNumber)) {
      const completed = this.completedTranscripts.get(this.nextTranscriptTaskNumber);
      this.completedTranscripts.delete(this.nextTranscriptTaskNumber);
      this.nextTranscriptTaskNumber += 1;
      if (completed) this.emit('transcript', completed);
    }
  }

  private applyTermCorrection(text: string): string {
    if (!this.termCorrection?.enabled || this.termCorrection.terms.length === 0) {
      return text;
    }
    return applySenseVoiceTermCorrection(text, this.termCorrection.terms);
  }

  private flushVad(): void {
    if (!this.vad) return;
    this.cancelGapFlushTimer();
    this.cancelSpeechEndedFlushTimer();
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
    const copiedSamples = samples.slice();
    if (this.pendingAudio.length >= LocalSenseVoiceSTT.MAX_PENDING_AUDIO_SEGMENTS) {
      const tailIndex = this.pendingAudio.length - 1;
      const tail = this.pendingAudio[tailIndex];
      const merged = new Float32Array(tail.samples.length + copiedSamples.length);
      merged.set(tail.samples);
      merged.set(copiedSamples, tail.samples.length);
      this.pendingAudio[tailIndex] = {
        samples: merged,
        sourceSegmentCount: tail.sourceSegmentCount + 1,
      };
    } else {
      this.pendingAudio.push({ samples: copiedSamples, sourceSegmentCount: 1 });
    }
    this.flushPendingAudio();
  }

  private flushPendingAudio(): void {
    if (!this.worker || !this.workerReady) return;
    while (
      this.pendingAudio.length > 0
      && this.inFlightTasks < LocalSenseVoiceSTT.MAX_IN_FLIGHT_TASKS
      && this.inFlightTasks + this.inFlightAnnotations < LocalSenseVoiceSTT.MAX_CONCURRENT_RESULT_TASKS
    ) {
      const pendingSegment = this.pendingAudio.shift();
      if (!pendingSegment) continue;
      const { samples } = pendingSegment;
      const taskId = `sensevoice-${++this.taskCounter}`;
      this.inFlightTasks++;
      this.pendingAudioByTaskId.set(taskId, {
        samples: samples.slice(),
        sourceSegmentCount: pendingSegment.sourceSegmentCount,
      });
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

  private async annotateSpeaker(taskId: string) {
    const pendingSegment = this.pendingAudioByTaskId.get(taskId);
    this.pendingAudioByTaskId.delete(taskId);
    if (!pendingSegment) return undefined;
    const { samples } = pendingSegment;
    return this.speakerVerificationAnnotator?.annotate(samples);
  }

  private resetGapFlushTimer(): void {
    this.cancelGapFlushTimer();
    this.gapFlushTimer = setTimeout(() => {
      this.gapFlushTimer = null;
      if (this._isActive) {
        this.flushVad();
      }
    }, LocalSenseVoiceSTT.GAP_FLUSH_MS);
  }

  private cancelGapFlushTimer(): void {
    if (!this.gapFlushTimer) return;
    clearTimeout(this.gapFlushTimer);
    this.gapFlushTimer = null;
  }

  private resetSpeechEndedFlushTimer(): void {
    this.cancelSpeechEndedFlushTimer();
    this.speechEndedFlushTimer = setTimeout(() => {
      this.speechEndedFlushTimer = null;
      if (this._isActive) {
        this.flushVad();
      }
    }, LocalSenseVoiceSTT.SPEECH_ENDED_FLUSH_DEBOUNCE_MS);
  }

  private cancelSpeechEndedFlushTimer(): void {
    if (!this.speechEndedFlushTimer) return;
    clearTimeout(this.speechEndedFlushTimer);
    this.speechEndedFlushTimer = null;
  }
}
