import type { AudioQualityResult, SpeakerRecordingQualityPolicy } from './speakerVerificationTypes';

const TARGET_SAMPLE_RATE = 16_000;

export const SPEAKER_RECORDING_QUALITY_POLICY: SpeakerRecordingQualityPolicy = {
  minDurationMs: 1500,
  minRms: 0.005,
  minVoiceRatio: 0.12,
  voiceSampleThreshold: 0.01,
  minVerificationDurationMs: 1500,
};

export function float32ToBuffer16(samples: Float32Array): Buffer {
  const out = Buffer.alloc(samples.length * 2);
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    out.writeInt16LE(Math.round(clamped * 32767), i * 2);
  }
  return out;
}

export function buffer16ToFloat32(pcm: Buffer): Float32Array {
  const samples = new Float32Array(Math.floor(pcm.length / 2));
  for (let i = 0; i < samples.length; i++) {
    samples[i] = pcm.readInt16LE(i * 2) / 32768;
  }
  return samples;
}

export function resampleFloat32To16k(samples: Float32Array, sampleRate: number): Float32Array {
  if (sampleRate === TARGET_SAMPLE_RATE) return samples.slice();
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return new Float32Array();
  const factor = sampleRate / TARGET_SAMPLE_RATE;
  const outLen = Math.floor(samples.length / factor);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    out[i] = samples[Math.min(samples.length - 1, Math.floor(i * factor))] ?? 0;
  }
  return out;
}

export function normalizeL2(vector: Float32Array): Float32Array {
  let norm = 0;
  for (const value of vector) norm += value * value;
  norm = Math.sqrt(norm);
  if (!Number.isFinite(norm) || norm === 0) return vector.slice();
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

export function meanEmbedding(embeddings: Float32Array[]): Float32Array {
  if (embeddings.length === 0) return new Float32Array();
  const dim = embeddings[0].length;
  const mean = new Float32Array(dim);
  for (const embedding of embeddings) {
    if (embedding.length !== dim) throw new Error('embedding_dimension_mismatch');
    for (let i = 0; i < dim; i++) mean[i] += embedding[i];
  }
  for (let i = 0; i < dim; i++) mean[i] /= embeddings.length;
  return normalizeL2(mean);
}

export function slidingWindows(samples16k: Float32Array, windowMs = 2000, hopMs = 1000): Float32Array[] {
  const windowSamples = Math.floor((windowMs * TARGET_SAMPLE_RATE) / 1000);
  const hopSamples = Math.floor((hopMs * TARGET_SAMPLE_RATE) / 1000);
  const windows: Float32Array[] = [];
  for (let start = 0; start + windowSamples <= samples16k.length; start += hopSamples) {
    windows.push(samples16k.slice(start, start + windowSamples));
  }
  return windows;
}

export function measureAudioQuality(
  samples16k: Float32Array,
  policy = SPEAKER_RECORDING_QUALITY_POLICY,
): AudioQualityResult {
  if (samples16k.length === 0) {
    return { ok: false, durationMs: 0, rms: 0, voiceRatio: 0, reason: 'empty' };
  }

  let sumSquares = 0;
  let voiced = 0;
  for (const value of samples16k) {
    sumSquares += value * value;
    if (Math.abs(value) >= policy.voiceSampleThreshold) voiced += 1;
  }

  const rms = Math.sqrt(sumSquares / samples16k.length);
  const durationMs = Math.round((samples16k.length / TARGET_SAMPLE_RATE) * 1000);
  const voiceRatio = voiced / samples16k.length;

  if (durationMs < policy.minDurationMs) return { ok: false, durationMs, rms, voiceRatio, reason: 'too_short' };
  if (rms < policy.minRms) return { ok: false, durationMs, rms, voiceRatio, reason: 'too_quiet' };
  if (voiceRatio < policy.minVoiceRatio) return { ok: false, durationMs, rms, voiceRatio, reason: 'not_enough_voice' };
  return { ok: true, durationMs, rms, voiceRatio };
}
