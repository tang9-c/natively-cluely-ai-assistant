#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function readOption(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function median(values) {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
}

export function summarizeProcessTree(table, rootPid) {
  const selected = new Set([rootPid]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const row of table) {
      if (selected.has(row.ppid) && !selected.has(row.pid)) {
        selected.add(row.pid);
        changed = true;
      }
    }
  }
  const rows = table.filter(row => selected.has(row.pid));
  return {
    pids: rows.map(row => row.pid).sort((left, right) => left - right),
    rssKb: rows.reduce((total, row) => total + row.rssKb, 0),
  };
}

function readProcessTable() {
  return execFileSync('ps', ['-axo', 'pid=,ppid=,rss=,command='], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(line => line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/))
    .filter(Boolean)
    .map(match => ({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKb: Number(match[3]),
      command: match[4],
    }));
}

export async function benchmarkPackagedIdleMemory(options) {
  const executable = path.resolve(options.executable);
  if (!fs.existsSync(executable)) throw new Error(`Missing packaged executable: ${executable}`);
  const profileDir = options.profileDir
    ? path.resolve(options.profileDir)
    : fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-idle-profile-'));
  fs.mkdirSync(profileDir, { recursive: true });

  let logTail = '';
  const child = spawn(executable, [`--user-data-dir=${profileDir}`], {
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const collectLog = chunk => {
    logTail = `${logTail}${chunk.toString('utf8')}`.slice(-100_000);
  };
  child.stdout.on('data', collectLog);
  child.stderr.on('data', collectLog);

  const samples = [];
  let lastTable = [];
  let lastTree = { pids: [child.pid], rssKb: 0 };
  try {
    const startedAt = Date.now();
    while (Date.now() - startedAt < options.durationMs) {
      if (child.exitCode !== null) {
        throw new Error(`Packaged app exited early with ${child.exitCode}. Logs:\n${logTail}`);
      }
      lastTable = readProcessTable();
      lastTree = summarizeProcessTree(lastTable, child.pid);
      if (lastTree.rssKb > 0) samples.push(lastTree.rssKb);
      await new Promise(resolve => setTimeout(resolve, options.sampleIntervalMs));
    }
  } finally {
    child.kill('SIGTERM');
    await new Promise(resolve => setTimeout(resolve, 1_000));
    for (const pid of [...lastTree.pids].reverse()) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
  }

  if (samples.length < 5) throw new Error(`Insufficient idle RSS samples: ${samples.length}`);
  const steadySamples = samples.slice(Math.floor(samples.length / 2));
  const processBreakdown = lastTable
    .filter(row => lastTree.pids.includes(row.pid))
    .map(row => ({ pid: row.pid, ppid: row.ppid, rssBytes: row.rssKb * 1024, command: row.command }));
  const lifecycleSignals = logTail
    .split('\n')
    .filter(line => /EmbeddingPipeline|SettingsWindowHelper|CropperWindowHelper|RAGManager|LocalSenseVoice|LocalSttWorkerPool|ModelPreloader/.test(line))
    .slice(-30);
  return {
    executable,
    profileDir,
    durationMs: options.durationMs,
    sampleCount: samples.length,
    processCount: lastTree.pids.length,
    processBreakdown,
    lifecycleSignals,
    steadyRssBytes: median(steadySamples) * 1024,
    peakRssBytes: Math.max(...samples) * 1024,
  };
}

const invokedAsScript = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedAsScript) {
  const executable = readOption('executable');
  const profileDir = readOption('profile-dir');
  const durationMs = Number(readOption('duration-ms') ?? 20_000);
  const sampleIntervalMs = Number(readOption('sample-interval-ms') ?? 250);
  if (!executable || durationMs < 5_000 || sampleIntervalMs < 50) {
    console.error('Usage: node scripts/benchmark-packaged-idle-memory.mjs --executable <path> [--profile-dir <path>] [--duration-ms 20000]');
    process.exit(2);
  }
  benchmarkPackagedIdleMemory({ executable, profileDir, durationMs, sampleIntervalMs })
    .then(result => console.log(JSON.stringify(result, null, 2)))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}
