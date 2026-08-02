interface SpeakerEmbeddingWorkerRequest {
  requestId: number;
  samples: number[];
}

const modelFile = process.env.SPEAKER_EMBEDDING_WORKER_MODEL_FILE;
let extractor: any;

function getExtractor(): any {
  if (extractor) return extractor;
  if (!modelFile) {
    throw new Error('speaker_embedding_worker_missing_model_file');
  }
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

if (!process.send) {
  throw new Error('SpeakerEmbeddingExtractorWorker must run as a forked child process');
}

process.on('message', (message: SpeakerEmbeddingWorkerRequest) => {
  try {
    const embedding = computeEmbedding(Float32Array.from(message.samples));
    process.send!({ requestId: message.requestId, embedding: Array.from(embedding) });
  } catch {
    process.send!({
      requestId: message.requestId,
      error: 'speaker_embedding_worker_failed',
    });
  }
});
