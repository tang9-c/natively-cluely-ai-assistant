export const SPEAKER_VOICE_FRAME_MS = 20;

export interface VoiceActivityAccumulator {
  totalSamples: number;
  sumSquares: number;
  completedFrames: number;
  voicedFrames: number;
  pendingFrameSamples: number;
  pendingFrameSumSquares: number;
}

export interface VoiceActivityMetrics {
  rms: number;
  voiceRatio: number;
}

export function createVoiceActivityAccumulator(): VoiceActivityAccumulator {
  return {
    totalSamples: 0,
    sumSquares: 0,
    completedFrames: 0,
    voicedFrames: 0,
    pendingFrameSamples: 0,
    pendingFrameSumSquares: 0,
  };
}

export function appendVoiceActivitySamples(
  accumulator: VoiceActivityAccumulator,
  samples: Float32Array,
  sampleRate: number,
  frameRmsThreshold: number,
): VoiceActivityMetrics {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    return { rms: 0, voiceRatio: 0 };
  }

  const frameSamples = Math.max(1, Math.round((sampleRate * SPEAKER_VOICE_FRAME_MS) / 1000));
  for (const value of samples) {
    const square = value * value;
    accumulator.totalSamples += 1;
    accumulator.sumSquares += square;
    accumulator.pendingFrameSamples += 1;
    accumulator.pendingFrameSumSquares += square;

    if (accumulator.pendingFrameSamples === frameSamples) {
      const frameRms = Math.sqrt(accumulator.pendingFrameSumSquares / accumulator.pendingFrameSamples);
      accumulator.completedFrames += 1;
      if (frameRms >= frameRmsThreshold) accumulator.voicedFrames += 1;
      accumulator.pendingFrameSamples = 0;
      accumulator.pendingFrameSumSquares = 0;
    }
  }

  const hasPendingFrame = accumulator.pendingFrameSamples > 0;
  const pendingFrameRms = hasPendingFrame
    ? Math.sqrt(accumulator.pendingFrameSumSquares / accumulator.pendingFrameSamples)
    : 0;
  const totalFrames = accumulator.completedFrames + (hasPendingFrame ? 1 : 0);
  const voicedFrames = accumulator.voicedFrames
    + (hasPendingFrame && pendingFrameRms >= frameRmsThreshold ? 1 : 0);

  return {
    rms: accumulator.totalSamples > 0
      ? Math.sqrt(accumulator.sumSquares / accumulator.totalSamples)
      : 0,
    voiceRatio: totalFrames > 0 ? voicedFrames / totalFrames : 0,
  };
}

export function measureVoiceActivity(
  samples: Float32Array,
  sampleRate: number,
  frameRmsThreshold: number,
): VoiceActivityMetrics {
  return appendVoiceActivitySamples(
    createVoiceActivityAccumulator(),
    samples,
    sampleRate,
    frameRmsThreshold,
  );
}
