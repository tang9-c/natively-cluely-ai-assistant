import fs from 'fs';
import path from 'path';

function findFirstExistingPath(candidates: readonly string[]): string {
  return candidates.find(candidate => fs.existsSync(candidate)) ?? candidates[0];
}

export function resolveSenseVoiceWorkerPath(): string {
  return findFirstExistingPath([
    path.join(__dirname, 'senseVoiceWorker.js'),
    path.join(__dirname, 'audio', 'sensevoice', 'senseVoiceWorker.js'),
  ]);
}
