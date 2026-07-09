import fs from 'fs';
import path from 'path';
import { DynamicActionEngine } from '../dynamic-actions/DynamicActionEngine';
import type { DynamicActionProductFixture } from '../dynamic-actions/DynamicActionProductFixtures';

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
  audioRoot?: string;
  fixtureRoot?: string;
  modeTemplateTypes?: string[];
  transcribeAudio?: (input: {
    entry: ReplayManifestEntry;
    audioPath: string;
  }) => string | undefined | Promise<string | undefined>;
}

export interface ReplayReport {
  totalEntries: number;
  skippedEntries: number;
  failedEntries: number;
  passedEntries: number;
  entries: ReplayReportEntry[];
}

export interface ReplayReportEntry {
  id: string;
  status: 'passed' | 'skipped' | 'failed';
  reason?: string;
  emitted?: boolean;
  actionType?: string;
  expectedActionType?: string;
  transcriptLength?: number;
}

export function loadFixtureBackedSttTranscripts(input: {
  manifestPath: string;
  fixtureRoot?: string;
}): Map<string, string> {
  const entries = JSON.parse(fs.readFileSync(input.manifestPath, 'utf8')) as ReplayManifestEntry[];
  const fixtureRoot = input.fixtureRoot ?? path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product');
  const cache = new Map<string, DynamicActionProductFixture[]>();
  const transcripts = new Map<string, string>();

  for (const entry of entries) {
    const fixture = loadSourceFixture(entry.sourceFixture, fixtureRoot, cache);
    if (!fixture) continue;
    transcripts.set(entry.id, fixture.transcriptTurns.map((turn) => turn.text).join('\n'));
  }

  return transcripts;
}

export async function runDynamicActionReplay(input: ReplayRunnerInput): Promise<ReplayReport> {
  const allEntries = JSON.parse(fs.readFileSync(input.manifestPath, 'utf8')) as ReplayManifestEntry[];
  const entries = input.modeTemplateTypes?.length
    ? allEntries.filter((entry) => input.modeTemplateTypes?.includes(entry.modeTemplateType))
    : allEntries;
  const audioRoot = input.audioRoot ?? process.cwd();
  const fixtureRoot = input.fixtureRoot ?? path.join(process.cwd(), 'tests/fixtures/dynamic-actions/product');
  const fixtureCache = new Map<string, DynamicActionProductFixture[]>();
  const engine = new DynamicActionEngine();
  const reportEntries: ReplayReportEntry[] = [];

  for (const entry of entries) {
    const audioPath = path.isAbsolute(entry.audioPath)
      ? entry.audioPath
      : path.resolve(audioRoot, entry.audioPath);
    if (!fs.existsSync(audioPath)) {
      reportEntries.push(entry.expectedMissingAudio
        ? { id: entry.id, status: 'skipped' as const, reason: 'pending_audio_generation' }
        : { id: entry.id, status: 'failed' as const, reason: 'audio_missing' });
      continue;
    }

    if (!input.transcribeAudio) {
      reportEntries.push({ id: entry.id, status: 'skipped', reason: 'audio_replay_not_enabled_in_this_phase' });
      continue;
    }

    const fixture = loadSourceFixture(entry.sourceFixture, fixtureRoot, fixtureCache);
    if (!fixture) {
      reportEntries.push({ id: entry.id, status: 'failed', reason: 'source_fixture_not_found' });
      continue;
    }

    const transcript = await input.transcribeAudio({ entry, audioPath });
    if (!transcript?.trim()) {
      reportEntries.push({ id: entry.id, status: 'failed', reason: 'stt_empty_transcript' });
      continue;
    }

    const actions = engine.detectActions({
      transcript,
      modeTemplateType: entry.modeTemplateType,
      modeId: entry.modeTemplateType,
      sessionId: `replay-${entry.id}`,
      language: entry.language,
    });
    const expectedActionType = fixture.expected.actionType;
    const matchedAction = expectedActionType
      ? actions.find((action) => action.type === expectedActionType)
      : undefined;
    const emitted = actions.length > 0;
    const passed = fixture.expected.shouldEmit
      ? !!matchedAction
      : !emitted;

    reportEntries.push({
      id: entry.id,
      status: passed ? 'passed' : 'failed',
      reason: passed ? undefined : 'dynamic_action_expectation_mismatch',
      emitted,
      actionType: matchedAction?.type ?? actions[0]?.type,
      expectedActionType,
      transcriptLength: transcript.length,
    });
  }

  const report: ReplayReport = {
    totalEntries: entries.length,
    skippedEntries: reportEntries.filter((entry) => entry.status === 'skipped').length,
    failedEntries: reportEntries.filter((entry) => entry.status === 'failed').length,
    passedEntries: reportEntries.filter((entry) => entry.status === 'passed').length,
    entries: reportEntries,
  };
  fs.mkdirSync(input.outputDir, { recursive: true });
  fs.writeFileSync(path.join(input.outputDir, 'replay-report.json'), JSON.stringify(report, null, 2));
  return report;
}

function loadSourceFixture(
  sourceFixture: string,
  fixtureRoot: string,
  cache: Map<string, DynamicActionProductFixture[]>,
): DynamicActionProductFixture | undefined {
  const [sourcePath, fixtureId] = sourceFixture.split('#');
  if (!sourcePath || !fixtureId) return undefined;
  const fileName = path.basename(sourcePath);
  const filePath = path.join(fixtureRoot, fileName);
  if (!cache.has(filePath)) {
    if (!fs.existsSync(filePath)) return undefined;
    cache.set(filePath, JSON.parse(fs.readFileSync(filePath, 'utf8')) as DynamicActionProductFixture[]);
  }
  return cache.get(filePath)?.find((fixture) => fixture.id === fixtureId);
}
