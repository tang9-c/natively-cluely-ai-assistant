#!/usr/bin/env node
// Run the full electron unit test suite under c8 and produce a coverage report.
// Output goes to coverage/report (HTML, lcov, json-summary, text).
//
// Usage:
//   node scripts/coverage/run-c8.mjs [--no-build] [--baseline]
//
// Flags:
//   --no-build   Skip the npm run build:electron pre-step (used by sub-runs).
//   --baseline   After running, copy coverage-summary.json to
//                coverage/baseline.json so future runs can compute deltas.

import { spawnSync } from 'node:child_process';
import { existsSync, rmSync, readdirSync, mkdirSync, copyFileSync, statSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const skipBuild = args.includes('--no-build');
const writeBaseline = args.includes('--baseline');

function run(cmd, commandArgs, env = {}) {
  console.log(`\n[cov] $ ${cmd} ${commandArgs.join(' ')}`);
  const result = spawnSync(cmd, commandArgs, {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// 1. Ensure dist-electron is fresh enough that source files actually exist.
if (!skipBuild) {
  run('npm', ['run', 'build:electron']);
}

// 2. Collect every *.test.mjs under electron/ (including newly-added
//    __tests__ directories) so coverage reflects the whole suite, not just
//    the three directories that npm test happens to enumerate.
function collectTestFiles(absDir, relDir) {
  const out = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const childAbs = join(absDir, entry.name);
    const childRel = `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...collectTestFiles(childAbs, childRel));
    } else if (entry.isFile() && entry.name.endsWith('.test.mjs')) {
      out.push(childRel);
    }
  }
  return out;
}

const electronDir = join(repoRoot, 'electron');
const testFiles = collectTestFiles(electronDir, 'electron').sort();
if (testFiles.length === 0) {
  console.error('[cov] no test files found under electron/');
  process.exit(1);
}
console.log(`[cov] collected ${testFiles.length} test files`);

// 3. Clear stale V8 dumps so the merged report reflects this run only.
const tmpDir = resolve(repoRoot, 'coverage/tmp');
if (existsSync(tmpDir)) {
  rmSync(tmpDir, { recursive: true, force: true });
}
mkdirSync(tmpDir, { recursive: true });

// 4. Run c8 without --all: only files actually required by the test run are
//    scored. This matches what the previous ad-hoc baseline (30.88% lines)
//    measured and gives a stable, comparable denominator. ELECTRON_RUN_AS_NODE=1
//    turns electron into a plain Node binary so node --test works.
run(
  'node',
  [
    './node_modules/.bin/c8',
    '--check-coverage=false',
    'env',
    `ELECTRON_RUN_AS_NODE=1`,
    'npx',
    'electron',
    '--experimental-test-module-mocks',
    '--test',
    '--test-force-exit',
    ...testFiles,
  ],
);

// 5. Optionally snapshot the current summary as the baseline.
if (writeBaseline) {
  const summary = resolve(repoRoot, 'coverage/report/coverage-summary.json');
  const baseline = resolve(repoRoot, 'coverage/baseline.json');
  if (!existsSync(summary)) {
    console.error('[cov] coverage-summary.json missing; baseline not written');
    process.exit(1);
  }
  copyFileSync(summary, baseline);
  console.log(`[cov] wrote baseline → ${baseline}`);
}

console.log('\n[cov] done. See coverage/report/index.html');