#!/usr/bin/env node

import 'dotenv/config';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildExperimentMatrix,
  chooseWinner,
  summarizeSamples,
} from './lib/qcloudSttDiagnostics.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUALITY_THRESHOLDS = { characterErrorRate: 0.35, keywordRecall: 0.75, lengthRatio: 0.75 };
const CURRENT_DEFAULTS = { poll: 'poll-2000', segment: 'segment-10', vad: 'vad-qcloud-current' };

export function parseMatrixArgs(argv) {
  const options = { machine: 'm4-16gb', audio: null, reference: null, outputDir: null };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) throw new Error('incomplete_option');
    if (flag === '--machine') options.machine = value;
    else if (flag === '--audio') options.audio = value;
    else if (flag === '--reference') options.reference = value;
    else if (flag === '--output-dir') options.outputDir = value;
    else throw new Error('unknown_option');
    index += 1;
  }
  if (options.machine !== 'm4-16gb') throw new Error('invalid_machine');
  return options;
}

export function resolveCellParameters(cell, winners) {
  return {
    ...cell,
    segmentSeconds: cell.segmentSeconds === '$segmentWinner'
      ? winners.segment?.segmentSeconds
      : cell.segmentSeconds,
    pollIntervalMs: cell.pollIntervalMs === '$pollWinner'
      ? winners.poll?.pollIntervalMs
      : cell.pollIntervalMs,
  };
}

function validCount(samples) {
  return samples.filter(sample => sample?.valid === true).length;
}

export async function ensureCellSamples({
  cell,
  targetValidSamples,
  loadCell,
  saveCell,
  collectSamples,
}) {
  const existing = await loadCell(cell.id);
  const samples = Array.isArray(existing?.samples) ? [...existing.samples] : [];
  const missing = Math.max(0, targetValidSamples - validCount(samples));
  if (missing > 0) {
    let collected;
    try {
      collected = await collectSamples(cell, missing);
    } catch {
      collected = [{ valid: false, failureStage: 'runner_failed' }];
    }
    for (const item of Array.isArray(collected) ? collected : []) {
      samples.push({ ...item, index: samples.length + 1 });
    }
  }
  const state = {
    schemaVersion: 1,
    configuration: {
      segmentSeconds: cell.segmentSeconds,
      pollIntervalMs: cell.pollIntervalMs,
      parameterGroup: cell.parameterGroup,
    },
    targetValidSamples,
    summary: summarizeSamples(samples, QUALITY_THRESHOLDS),
    samples,
  };
  if (missing > 0) await saveCell(cell.id, state);
  return state;
}

function publicCell(cell, state) {
  return {
    id: cell.id,
    segmentSeconds: cell.segmentSeconds,
    pollIntervalMs: cell.pollIntervalMs,
    parameterGroup: cell.parameterGroup,
    summary: state.summary,
  };
}

export async function executeDiagnosticMatrix({ matrix, loadCell, saveCell, collectSamples }) {
  const winners = {};
  const stages = [];
  for (const stage of matrix) {
    const resolvedCells = stage.cells.map(cell => resolveCellParameters(cell, winners));
    const candidates = [];
    for (const cell of resolvedCells) {
      const state = await ensureCellSamples({
        cell,
        targetValidSamples: stage.screeningSamples,
        loadCell,
        saveCell,
        collectSamples,
      });
      candidates.push(publicCell(cell, state));
    }

    const screened = candidates.filter(candidate => candidate.summary.validCount >= stage.screeningSamples);
    if (screened.length !== candidates.length) {
      stages.push({ id: stage.id, status: 'blocked', candidates, winner: null });
      return {
        schemaVersion: 1,
        status: 'blocked',
        generatedAt: new Date().toISOString(),
        blockedStage: stage.id,
        stages,
      };
    }
    const selected = chooseWinner(screened, CURRENT_DEFAULTS[stage.id]);
    if (!selected) {
      stages.push({ id: stage.id, status: 'blocked', candidates, winner: null });
      return {
        schemaVersion: 1,
        status: 'blocked',
        generatedAt: new Date().toISOString(),
        blockedStage: stage.id,
        stages,
      };
    }

    const winnerCell = resolvedCells.find(cell => cell.id === selected.id);
    const finalistState = await ensureCellSamples({
      cell: winnerCell,
      targetValidSamples: stage.finalistSamples,
      loadCell,
      saveCell,
      collectSamples,
    });
    const winner = publicCell(winnerCell, finalistState);
    if (winner.summary.validCount < stage.finalistSamples || winner.summary.quality.passed !== true) {
      stages.push({ id: stage.id, status: 'blocked', candidates, winner });
      return {
        schemaVersion: 1,
        status: 'blocked',
        generatedAt: new Date().toISOString(),
        blockedStage: stage.id,
        stages,
      };
    }

    winners[stage.id] = winner;
    stages.push({ id: stage.id, status: 'completed', candidates, winner });
  }

  return {
    schemaVersion: 1,
    status: 'completed',
    generatedAt: new Date().toISOString(),
    blockedStage: null,
    environment: { machine: 'Apple M4 / 16GB' },
    stages,
    recommendation: {
      pollIntervalMs: winners.poll.pollIntervalMs,
      segmentSeconds: winners.segment.segmentSeconds,
      parameterGroup: winners.vad.parameterGroup,
    },
  };
}

async function writeJsonAtomic(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fsp.rename(temporary, filePath);
}

function runProcess(command, args, options = {}) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd: ROOT, stdio: 'inherit', ...options });
    child.once('error', () => resolve({ code: 1 }));
    child.once('exit', code => resolve({ code: code ?? 1 }));
  });
}

async function serverReady() {
  try {
    return (await fetch('http://localhost:5180')).ok;
  } catch {
    return false;
  }
}

async function ensureViteServer() {
  if (await serverReady()) return null;
  const child = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
    cwd: ROOT,
    stdio: 'inherit',
  });
  for (let attempt = 0; attempt < 150; attempt += 1) {
    if (await serverReady()) return child;
    if (child.exitCode != null) throw new Error('vite_start_failed');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  child.kill('SIGTERM');
  throw new Error('vite_not_ready');
}

async function collectWithChild(options, cell, missing) {
  const temporary = path.join(options.outputDir, `.runner-${cell.id}-${process.pid}-${Date.now()}.json`);
  const args = [
    'scripts/benchmark-qcloud-stt-renderer.mjs',
    '--output', temporary,
    '--audio', options.audio,
    '--reference', options.reference,
    '--segment-seconds', String(cell.segmentSeconds),
    '--poll-interval-ms', String(cell.pollIntervalMs),
    '--parameter-group', cell.parameterGroup,
    '--valid-samples', String(missing),
    '--max-sample-attempts', String(missing * 3),
  ];
  await runProcess(process.execPath, args);
  try {
    const report = JSON.parse(await fsp.readFile(temporary, 'utf8'));
    return Array.isArray(report.samples) ? report.samples : [{ valid: false, failureStage: 'runner_failed' }];
  } catch {
    return [{ valid: false, failureStage: 'runner_failed' }];
  } finally {
    await fsp.rm(temporary, { force: true });
  }
}

function assertRuntimeOptions(options) {
  if (!options.audio) throw new Error('missing_audio');
  if (!options.reference) throw new Error('missing_reference');
  if (!options.outputDir) throw new Error('missing_output_dir');
  if (!fs.existsSync(options.audio)) throw new Error('missing_audio');
  if (!fs.existsSync(options.reference)) throw new Error('missing_reference');
}

export async function runMatrix(options) {
  assertRuntimeOptions(options);
  const build = await runProcess('npm', ['run', 'build:electron']);
  if (build.code !== 0) throw new Error('electron_build_failed');
  const vite = await ensureViteServer();
  try {
    const cellPath = id => path.join(options.outputDir, 'cells', `${id}.json`);
    const report = await executeDiagnosticMatrix({
      matrix: buildExperimentMatrix(),
      loadCell: async id => {
        try {
          return JSON.parse(await fsp.readFile(cellPath(id), 'utf8'));
        } catch {
          return null;
        }
      },
      saveCell: (id, state) => writeJsonAtomic(cellPath(id), state),
      collectSamples: (cell, missing) => collectWithChild(options, cell, missing),
    });
    await writeJsonAtomic(path.join(options.outputDir, 'final.json'), report);
    return report;
  } finally {
    vite?.kill('SIGTERM');
  }
}

async function main() {
  const report = await runMatrix(parseMatrixArgs(process.argv.slice(2)));
  if (report.status !== 'completed') process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
