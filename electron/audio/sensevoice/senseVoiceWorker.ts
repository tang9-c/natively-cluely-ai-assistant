import { parentPort } from 'worker_threads';
import type { SenseVoiceWorkerInMessage } from './types';
import { isVerboseLogging } from '../../verboseLog';

if (!parentPort) throw new Error('senseVoiceWorker must be run as a Worker thread');

let recognizer: any = null;
let workerVerboseLogging = false;

function debugLog(event: string, metadata: Record<string, unknown> = {}): void {
  if (!workerVerboseLogging && !isVerboseLogging()) return;
  console.log(`[SenseVoiceWorker] ${event}`, metadata);
}

function createRecognizer(msg: Extract<SenseVoiceWorkerInMessage, { type: 'init' }>): any {
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
      provider: 'cpu',
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

parentPort.on('message', (msg: SenseVoiceWorkerInMessage) => {
  if (typeof msg.verboseLogging === 'boolean') {
    workerVerboseLogging = msg.verboseLogging;
  }

  if (msg.type === 'init') {
    try {
      const startedAt = Date.now();
      recognizer = createRecognizer(msg);
      debugLog('ready', { durationMs: Date.now() - startedAt });
      parentPort!.postMessage({ type: 'ready' });
    } catch (error: any) {
      debugLog('init-error', { message: error?.message ?? String(error) });
      parentPort!.postMessage({
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
      parentPort!.postMessage({
        type: 'result',
        taskId: msg.taskId,
        text: transcribe(msg.samples),
      });
    } catch (error: any) {
      debugLog('transcribe-error', {
        taskId: msg.taskId,
        message: error?.message ?? String(error),
      });
      parentPort!.postMessage({
        type: 'error',
        taskId: msg.taskId,
        message: error?.message ?? String(error),
      });
    }
  }
});
