import fs from 'fs';
import path from 'path';
import { DynamicActionEngine } from '../dynamic-actions/DynamicActionEngine';
import type { DynamicActionProductFixture } from '../dynamic-actions/DynamicActionProductFixtures';
import {
  loadDynamicActionContinuationFixtures,
  runDynamicActionContinuationFixture,
  type ContinuationFixtureResult,
  type DynamicActionContinuationFixture,
} from './DynamicActionContinuationFixtureRunner';

export interface ReplayManifestEntry {
  id: string;
  modeTemplateType: string;
  sourceFixture: string;
  audioPath: string;
  expectedMissingAudio: boolean;
  language: string;
  speakerCount: number;
  syntheticAudio?: boolean;
  continuationFixture?: string;
}

export interface ReplayRunnerInput {
  manifestPath: string;
  outputDir: string;
  audioRoot?: string;
  fixtureRoot?: string;
  continuationFixtureRoot?: string;
  modeTemplateTypes?: string[];
  environmentStatus?: ReplayEnvironmentStatus;
  transcribeAudio?: (input: {
    entry: ReplayManifestEntry;
    audioPath: string;
  }) => string | undefined | Promise<string | undefined>;
}

export type ReplayEnvironmentStatus = 'ok' | 'blocked_missing_credentials' | 'not_applicable';
export type ReplayCoverageMode = 'sales' | 'fde' | 'team-meet';

export interface ReplayAssetCoverage {
  requiredReal: Record<ReplayCoverageMode, number>;
  availableReal: Record<ReplayCoverageMode, number>;
  availableSynthetic: Record<ReplayCoverageMode, number>;
  blockedReal: Record<ReplayCoverageMode, number>;
}

export interface ReplayReport {
  totalEntries: number;
  skippedEntries: number;
  failedEntries: number;
  passedEntries: number;
  environmentStatus: ReplayEnvironmentStatus;
  assetCoverage: ReplayAssetCoverage;
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
  continuation?: ContinuationFixtureResult;
  failureStage?: 'initial_action' | 'continuation' | 'runtime_evaluation' | 'post_call';
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
  const continuationFixtureRoot = input.continuationFixtureRoot ?? path.join(process.cwd(), 'tests/fixtures/dynamic-actions/continuation');
  const fixtureCache = new Map<string, DynamicActionProductFixture[]>();
  const continuationFixtureCache = new Map<string, DynamicActionContinuationFixture[]>();
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
      speaker: fixture.transcriptTurns[0]?.speaker,
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
    let passed = fixture.expected.shouldEmit
      ? !!matchedAction
      : !emitted;
    let continuation: ContinuationFixtureResult | undefined;
    let failureStage: ReplayReportEntry['failureStage'];
    if (passed && entry.continuationFixture) {
      const continuationFixture = loadContinuationFixture(entry.continuationFixture, continuationFixtureRoot, continuationFixtureCache);
      if (!continuationFixture) {
        passed = false;
        failureStage = 'continuation';
      } else {
        continuation = await runDynamicActionContinuationFixture({ fixture: continuationFixture });
        if (!continuation.passed) {
          passed = false;
          failureStage = continuation.failureStage ?? 'continuation';
        }
      }
    }

    reportEntries.push({
      id: entry.id,
      status: passed ? 'passed' : 'failed',
      reason: passed ? undefined : failureStage ? 'continuation_expectation_mismatch' : 'dynamic_action_expectation_mismatch',
      emitted,
      actionType: matchedAction?.type ?? actions[0]?.type,
      expectedActionType,
      transcriptLength: transcript.length,
      ...(continuation ? { continuation } : {}),
      ...(failureStage ? { failureStage } : {}),
    });
  }

  const report: ReplayReport = {
    totalEntries: entries.length,
    skippedEntries: reportEntries.filter((entry) => entry.status === 'skipped').length,
    failedEntries: reportEntries.filter((entry) => entry.status === 'failed').length,
    passedEntries: reportEntries.filter((entry) => entry.status === 'passed').length,
    environmentStatus: input.environmentStatus ?? (input.transcribeAudio ? 'ok' : 'not_applicable'),
    assetCoverage: buildAssetCoverage(allEntries, audioRoot),
    entries: reportEntries,
  };
  fs.mkdirSync(input.outputDir, { recursive: true });
  fs.writeFileSync(path.join(input.outputDir, 'replay-report.json'), JSON.stringify(report, null, 2));
  return report;
}

function loadContinuationFixture(
  continuationFixture: string,
  fixtureRoot: string,
  cache: Map<string, DynamicActionContinuationFixture[]>,
): DynamicActionContinuationFixture | undefined {
  const [sourcePath, fixtureId] = continuationFixture.split('#');
  if (!sourcePath || !fixtureId) return undefined;
  const filePath = path.join(fixtureRoot, path.basename(sourcePath));
  if (!cache.has(filePath)) {
    if (!fs.existsSync(filePath)) return undefined;
    cache.set(filePath, loadDynamicActionContinuationFixtures(filePath));
  }
  return cache.get(filePath)?.find((fixture) => fixture.id === fixtureId);
}

function buildAssetCoverage(entries: ReplayManifestEntry[], audioRoot: string): ReplayAssetCoverage {
  const requiredReal: Record<ReplayCoverageMode, number> = { sales: 15, fde: 10, 'team-meet': 5 };
  const availableReal: Record<ReplayCoverageMode, number> = { sales: 0, fde: 0, 'team-meet': 0 };
  const availableSynthetic: Record<ReplayCoverageMode, number> = { sales: 0, fde: 0, 'team-meet': 0 };
  const modes = new Set<ReplayCoverageMode>(['sales', 'fde', 'team-meet']);

  for (const entry of entries) {
    const mode = entry.modeTemplateType as ReplayCoverageMode;
    if (!modes.has(mode)) continue;
    const audioPath = path.isAbsolute(entry.audioPath)
      ? entry.audioPath
      : path.resolve(audioRoot, entry.audioPath);
    if (!fs.existsSync(audioPath)) continue;
    if (entry.syntheticAudio === true) {
      availableSynthetic[mode] += 1;
    } else {
      availableReal[mode] += 1;
    }
  }

  return {
    requiredReal,
    availableReal,
    availableSynthetic,
    blockedReal: {
      sales: Math.max(requiredReal.sales - availableReal.sales, 0),
      fde: Math.max(requiredReal.fde - availableReal.fde, 0),
      'team-meet': Math.max(requiredReal['team-meet'] - availableReal['team-meet'], 0),
    },
  };
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
