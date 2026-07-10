#!/usr/bin/env node
// Threshold gate for the Phase 4 / final goal. Fails with non-zero exit if
// coverage totals drop below the project-wide targets.
//
// Usage:
//   node scripts/coverage/check-threshold.mjs [--no-build]
//                  [--lines=85] [--statements=85] [--functions=75]
//
// The defaults match the goal stated in the 85% coverage plan; pass explicit
// values to dial the gate up or down for an intermediate phase.

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

function arg(name, fallback) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!hit) return fallback;
  const value = Number(hit.split('=')[1]);
  return Number.isFinite(value) ? value : fallback;
}

const linesTarget = arg('lines', 85);
const stmtsTarget = arg('statements', 85);
const funcsTarget = arg('functions', 75);
const skipBuild = process.argv.includes('--no-build');

const summaryPath = resolve(repoRoot, 'coverage/report/coverage-summary.json');
if (!existsSync(summaryPath)) {
  console.log('[threshold] coverage/report/coverage-summary.json missing; running c8 first...');
  const result = spawnSync('node', ['./scripts/coverage/run-c8.mjs', ...(skipBuild ? ['--no-build'] : [])], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));
const { lines, statements, functions } = summary.total;

const report = (label, pct, target) => {
  const ok = pct >= target;
  const mark = ok ? '✓' : '✗';
  console.log(`  ${mark} ${label.padEnd(10)} ${pct.toFixed(2).padStart(6)}%  (target ${target}%)`);
  return ok;
};

console.log('\n[threshold] coverage gate:');
const okLines = report('lines', lines.pct, linesTarget);
const okStmts = report('statements', statements.pct, stmtsTarget);
const okFuncs = report('functions', functions.pct, funcsTarget);

if (okLines && okStmts && okFuncs) {
  console.log('\n[threshold] PASS');
  process.exit(0);
}
console.error('\n[threshold] FAIL');
process.exit(1);