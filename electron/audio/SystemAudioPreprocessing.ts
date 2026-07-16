import { measurePcm16Level, normalizePcm16Chunk } from './audioLevelNormalizer';

export interface SystemAudioPreprocessingResult {
    chunk: Buffer;
    before: ReturnType<typeof measurePcm16Level>;
    gain: number;
}

export function preprocessCurrentChineseSystemAudio(chunk: Buffer): SystemAudioPreprocessingResult {
    return normalizePcm16Chunk(chunk, {
        targetRms: 0.015,
        maxGain: 4,
        silenceRms: 0.0005,
    });
}

export function measureSystemAudioPcm16Level(chunk: Buffer): ReturnType<typeof measurePcm16Level> {
    return measurePcm16Level(chunk);
}
