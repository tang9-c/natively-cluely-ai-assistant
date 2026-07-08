import fs from 'fs';
import path from 'path';

export interface ReplayManifestEntry {
  id: string;
  modeTemplateType: string;
  sourceFixture: string;
  audioPath: string;
  expectedMissingAudio: boolean;
  language: string;
  speakerCount: number;
}

export interface ReplayRunnerInput {
  manifestPath: string;
  outputDir: string;
}

export interface ReplayReport {
  totalEntries: number;
  skippedEntries: number;
  failedEntries: number;
  entries: Array<{ id: string; status: 'skipped' | 'failed'; reason: string }>;
}

export function runDynamicActionReplay(input: ReplayRunnerInput): ReplayReport {
  const entries = JSON.parse(fs.readFileSync(input.manifestPath, 'utf8')) as ReplayManifestEntry[];
  const reportEntries = entries.map((entry) => {
    if (!fs.existsSync(path.resolve(process.cwd(), entry.audioPath))) {
      return entry.expectedMissingAudio
        ? { id: entry.id, status: 'skipped' as const, reason: 'pending_audio_generation' }
        : { id: entry.id, status: 'failed' as const, reason: 'audio_missing' };
    }
    return { id: entry.id, status: 'skipped' as const, reason: 'audio_replay_not_enabled_in_this_phase' };
  });
  const report: ReplayReport = {
    totalEntries: entries.length,
    skippedEntries: reportEntries.filter((entry) => entry.status === 'skipped').length,
    failedEntries: reportEntries.filter((entry) => entry.status === 'failed').length,
    entries: reportEntries,
  };
  fs.mkdirSync(input.outputDir, { recursive: true });
  fs.writeFileSync(path.join(input.outputDir, 'replay-report.json'), JSON.stringify(report, null, 2));
  return report;
}
