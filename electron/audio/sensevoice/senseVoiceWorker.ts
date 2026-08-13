import { parentPort } from 'worker_threads';
import type { SenseVoiceWorkerInMessage } from './types';
import { isVerboseLogging } from '../../verboseLog';
import { initializeLocalSttProvider } from '../hardwareProviderPolicy';

const sendMessage = (message: Record<string, unknown>): void => {
  if (parentPort) parentPort.postMessage(message);
  else if (process.send) process.send(message);
};

const onMessage = (listener: (message: SenseVoiceWorkerInMessage) => void): void => {
  if (parentPort) parentPort.on('message', listener);
  else if (process.send) process.on('message', message => listener(message as SenseVoiceWorkerInMessage));
  else throw new Error('senseVoiceWorker requires worker_threads or child_process IPC');
};

let recognizer: any = null;
let workerVerboseLogging = false;

function debugLog(event: string, metadata: Record<string, unknown> = {}): void {
  if (!workerVerboseLogging && !isVerboseLogging()) return;
  console.log(`[SenseVoiceWorker] ${event}`, metadata);
}

function createRecognizer(msg: Extract<SenseVoiceWorkerInMessage, { type: 'init' }>, provider: string): any {
  const sherpa = require('sherpa-onnx-node');
  debugLog('create-recognizer', {
    modelFileConfigured: !!msg.modelFile,
    tokensFileConfigured: !!msg.tokensFile,
    numThreads: msg.numThreads,
  });
  return new sherpa.OfflineRecognizer({
    featConfig: {
      sampleRate: 16000,
      featureDim: 80,
    },
    modelConfig: {
      senseVoice: {
        model: msg.modelFile,
        useInverseTextNormalization: 1,
      },
      tokens: msg.tokensFile,
      numThreads: msg.numThreads,
      provider,
      debug: 0,
    },
  });
}

function transcribe(samples: Float32Array): string {
  if (!recognizer) throw new Error('SenseVoice recognizer is not initialized');
  const startedAt = Date.now();
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  const text = result?.text ?? '';
  debugLog('transcribe-complete', {
    sampleCount: samples.length,
    durationMs: Date.now() - startedAt,
    textLength: text.length,
  });
  return text;
}

onMessage((msg: SenseVoiceWorkerInMessage) => {
  if (typeof msg.verboseLogging === 'boolean') {
    workerVerboseLogging = msg.verboseLogging;
  }

  if (msg.type === 'init') {
    try {
      const startedAt = Date.now();
      const initialized = initializeLocalSttProvider({
        requestedProviders: msg.requestedProviders,
        fallbackProvider: msg.fallbackProvider,
        create: provider => createRecognizer(msg, provider),
      });
      recognizer = initialized.value;
      const initializationMs = Date.now() - startedAt;
      debugLog('ready', {
        providerRequested: initialized.providerRequested,
        providerActual: initialized.providerActual,
        fallbackReason: initialized.fallbackReason,
        initializationMs,
      });
      sendMessage({
        type: 'ready',
        providerRequested: initialized.providerRequested,
        providerActual: initialized.providerActual,
        fallbackReason: initialized.fallbackReason,
        initializationMs,
      });
    } catch (error: any) {
      debugLog('init-error', { message: error?.message ?? String(error) });
      sendMessage({
        type: 'error',
        message: `Failed to load SenseVoice model: ${error?.message ?? String(error)}`,
      });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      debugLog('transcribe-start', {
        taskId: msg.taskId,
        sampleCount: msg.samples.length,
      });
      sendMessage({
        type: 'result',
        taskId: msg.taskId,
        text: transcribe(msg.samples),
      });
    } catch (error: any) {
      debugLog('transcribe-error', {
        taskId: msg.taskId,
        message: error?.message ?? String(error),
      });
      sendMessage({
        type: 'error',
        taskId: msg.taskId,
        message: error?.message ?? String(error),
      });
    }
  }
});
