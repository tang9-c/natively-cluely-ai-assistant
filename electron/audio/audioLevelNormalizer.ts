export interface Pcm16Level {
  rms: number;
  peak: number;
}

export interface NormalizePcm16Options {
  targetRms: number;
  maxGain: number;
  silenceRms: number;
}

export interface NormalizePcm16Result {
  chunk: Buffer;
  gain: number;
  before: Pcm16Level;
}

export function measurePcm16Level(chunk: Buffer): Pcm16Level {
  if (chunk.length < 2) return { rms: 0, peak: 0 };

  let sumSquares = 0;
  let peak = 0;
  let samples = 0;
  for (let i = 0; i + 1 < chunk.length; i += 2) {
    const normalized = chunk.readInt16LE(i) / 32768;
    const abs = Math.abs(normalized);
    sumSquares += normalized * normalized;
    if (abs > peak) peak = abs;
    samples++;
  }

  return {
    rms: samples > 0 ? Math.sqrt(sumSquares / samples) : 0,
    peak,
  };
}

export function normalizePcm16Chunk(
  chunk: Buffer,
  options: NormalizePcm16Options,
): NormalizePcm16Result {
  const before = measurePcm16Level(chunk);
  if (before.rms <= options.silenceRms || before.peak <= 0) {
    return { chunk, gain: 1, before };
  }

  const gainByRms = options.targetRms / before.rms;
  const gainByPeak = 0.95 / before.peak;
  const gain = Math.max(1, Math.min(options.maxGain, gainByRms, gainByPeak));
  if (gain <= 1.01) {
    return { chunk, gain: 1, before };
  }

  const amplified = Buffer.allocUnsafe(chunk.length);
  for (let i = 0; i + 1 < chunk.length; i += 2) {
    const sample = Math.round(chunk.readInt16LE(i) * gain);
    amplified.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i);
  }

  if (chunk.length % 2 === 1) {
    amplified[chunk.length - 1] = chunk[chunk.length - 1];
  }

  return { chunk: amplified, gain, before };
}
