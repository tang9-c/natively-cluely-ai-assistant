export interface NormalizedSpeakerEnrollmentSample {
  samples: Float32Array;
  sampleRate: number;
  deviceFingerprint?: string;
}

export function decodeSpeakerEnrollmentPcm16(pcm16: ArrayBuffer | ArrayBufferView): Float32Array {
  const view = ArrayBuffer.isView(pcm16)
    ? new DataView(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
    : new DataView(pcm16);
  const samples = new Float32Array(Math.floor(view.byteLength / 2));
  for (let i = 0; i < samples.length; i += 1) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  return samples;
}

export function normalizeSpeakerEnrollmentSample(sample: any): NormalizedSpeakerEnrollmentSample {
  return {
    samples: sample?.pcm16
      ? decodeSpeakerEnrollmentPcm16(sample.pcm16)
      : Array.isArray(sample?.samples)
        ? new Float32Array(sample.samples)
        : new Float32Array(Array.from(sample?.samples ?? [])),
    sampleRate: Number(sample?.sampleRate) || 16000,
    deviceFingerprint: typeof sample?.deviceFingerprint === 'string' ? sample.deviceFingerprint : undefined,
  };
}
