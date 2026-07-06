#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function collectTestFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(repoRoot, fullPath);
    if (entry.isDirectory()) {
      if (
        relPath.includes(`node_modules${path.sep}`) ||
        relPath.startsWith(`dist${path.sep}`) ||
        relPath.startsWith(`dist-electron${path.sep}`)
      ) {
        continue;
      }
      files.push(...collectTestFiles(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      files.push(relPath);
    }
  }

  return files;
}

function runStage(stage) {
  if (stage.skipUnless && !stage.skipUnless()) {
    console.log(`\n[test:all] stage=${stage.name} result=SKIP reason=${stage.skipReason}`);
    return { name: stage.name, status: 0, skipped: true, durationMs: 0 };
  }

  console.log(`\n[test:all] stage=${stage.name} command=${stage.command} ${stage.args.join(' ')}`);
  const startedAt = Date.now();
  const result = spawnSync(stage.command, stage.args, {
    cwd: repoRoot,
    env: { ...process.env, ...(stage.env ?? {}) },
    stdio: 'inherit',
  });
  const durationMs = Date.now() - startedAt;
  const status = result.status ?? 1;

  if (status === 0) {
    console.log(`[test:all] stage=${stage.name} result=PASS durationMs=${durationMs}`);
  } else {
    console.error(`[test:all] stage=${stage.name} result=FAIL exitCode=${status} durationMs=${durationMs}`);
  }

  return { name: stage.name, status, durationMs };
}

const nodeTestFiles = [
  ...collectTestFiles(path.join(repoRoot, 'electron')),
  ...collectTestFiles(path.join(repoRoot, 'src')),
  ...collectTestFiles(path.join(repoRoot, 'scripts')),
].sort();

const stages = [
  {
    name: 'typecheck-electron',
    command: npmCmd,
    args: ['run', 'typecheck:electron'],
  },
  {
    name: 'build-electron',
    command: npmCmd,
    args: ['run', 'build:electron'],
  },
  {
    name: 'node-tests',
    command: npxCmd,
    args: [
      'electron',
      '--experimental-test-module-mocks',
      '--test',
      '--test-force-exit',
      ...nodeTestFiles,
    ],
    env: { ELECTRON_RUN_AS_NODE: '1' },
  },
  {
    name: 'e2e',
    command: npxCmd,
    args: ['playwright', 'test'],
    env: { ELECTRON_E2E: '1' },
  },
  {
    name: 'doubao-auc-real',
    command: npmCmd,
    args: ['run', 'test:doubao-auc:real'],
    skipUnless: () => process.env.DOUBAO_AUC_REAL_TESTS === '1',
    skipReason: 'set DOUBAO_AUC_REAL_TESTS=1 to run live Doubao AUC API test',
  },
  {
    name: 'screen-understanding-bench',
    command: npmCmd,
    args: ['run', 'bench:screen-understanding'],
  },
];

if (process.argv.includes('--help')) {
  console.log('Usage: node scripts/run-test-all.mjs [--list-stages]');
  console.log('Runs all test stages without short-circuiting, then exits non-zero if any stage fails.');
  process.exit(0);
}

if (process.argv.includes('--list-stages')) {
  for (const stage of stages) {
    console.log(stage.name);
  }
  process.exit(0);
}

const results = stages.map(runStage);
const failed = results.filter((result) => result.status !== 0);

console.log('\n[test:all] summary');
for (const result of results) {
  const label = result.skipped ? 'SKIP' : result.status === 0 ? 'PASS' : `FAIL(${result.status})`;
  console.log(`[test:all] ${result.name}: ${label} durationMs=${result.durationMs}`);
}

if (failed.length > 0) {
  console.error(`[test:all] failedStages=${failed.map((result) => result.name).join(',')}`);
  process.exit(1);
}

console.log('[test:all] all stages passed');
