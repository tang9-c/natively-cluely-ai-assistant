import { parentPort, workerData } from 'worker_threads';

interface SpeakerEmbeddingWorkerData {
  modelFile: string;
}

interface SpeakerEmbeddingWorkerRequest {
  requestId: number;
  samples: ArrayBuffer;
}

const { modelFile } = workerData as SpeakerEmbeddingWorkerData;
let extractor: any;

function getExtractor(): any {
  if (extractor) return extractor;
  const sherpa = require('sherpa-onnx-node');
  extractor = new sherpa.SpeakerEmbeddingExtractor({
    model: modelFile,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
  });
  return extractor;
}

function computeEmbedding(samples16k: Float32Array): Float32Array {
  const speakerExtractor = getExtractor();
  const stream = speakerExtractor.createStream();
  stream.acceptWaveform({ samples: samples16k, sampleRate: 16000 });
  stream.inputFinished();
  if (!speakerExtractor.isReady(stream)) {
    throw new Error('speaker_embedding_stream_not_ready');
  }
  return new Float32Array(speakerExtractor.compute(stream, false));
}

if (!parentPort) {
  throw new Error('SpeakerEmbeddingExtractorWorker must run as a worker_threads Worker');
}

parentPort.on('message', (message: SpeakerEmbeddingWorkerRequest) => {
  try {
    const embedding = computeEmbedding(new Float32Array(message.samples));
    const embeddingBuffer = embedding.buffer as ArrayBuffer;
    parentPort!.postMessage(
      { requestId: message.requestId, embedding: embeddingBuffer },
      [embeddingBuffer],
    );
  } catch {
    parentPort!.postMessage({
      requestId: message.requestId,
      error: 'speaker_embedding_worker_failed',
    });
  }
});
