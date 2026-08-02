import fs from 'fs';
import path from 'path';

export function findFirstExistingPath(
  candidates: readonly string[],
  exists: (candidate: string) => boolean = fs.existsSync,
): string {
  return candidates.find(candidate => exists(candidate)) ?? candidates[0];
}

export function resolveSpeakerEmbeddingWorkerPath(
  baseDir: string = __dirname,
  exists: (candidate: string) => boolean = fs.existsSync,
): string {
  return findFirstExistingPath([
    path.join(baseDir, 'SpeakerEmbeddingExtractorWorker.js'),
    path.join(baseDir, 'services', 'speaker', 'SpeakerEmbeddingExtractorWorker.js'),
    path.join(baseDir, 'electron', 'services', 'speaker', 'SpeakerEmbeddingExtractorWorker.js'),
  ], exists);
}
