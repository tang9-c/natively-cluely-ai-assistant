import { parentPort } from 'worker_threads';
import { cleanSenseVoiceText } from './textCleaner';
import type { SenseVoiceWorkerInMessage } from './types';

if (!parentPort) throw new Error('senseVoiceWorker must be run as a Worker thread');

let recognizer: any = null;

function createRecognizer(msg: Extract<SenseVoiceWorkerInMessage, { type: 'init' }>): any {
  const sherpa = require('sherpa-onnx-node');
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
  const stream = recognizer.createStream();
  stream.acceptWaveform({ samples, sampleRate: 16000 });
  recognizer.decode(stream);
  const result = recognizer.getResult(stream);
  return cleanSenseVoiceText(result?.text ?? '');
}

parentPort.on('message', (msg: SenseVoiceWorkerInMessage) => {
  if (msg.type === 'init') {
    try {
      recognizer = createRecognizer(msg);
      parentPort!.postMessage({ type: 'ready' });
    } catch (error: any) {
      parentPort!.postMessage({
        type: 'error',
        message: `Failed to load SenseVoice model: ${error?.message ?? String(error)}`,
      });
    }
    return;
  }

  if (msg.type === 'transcribe') {
    try {
      parentPort!.postMessage({
        type: 'result',
        taskId: msg.taskId,
        text: transcribe(msg.samples),
      });
    } catch (error: any) {
      parentPort!.postMessage({
        type: 'error',
        taskId: msg.taskId,
        message: error?.message ?? String(error),
      });
    }
  }
});
