#!/usr/bin/env node
// Diff the latest coverage summary against the saved baseline and emit a
// table showing per-file Δ lines/functions. Designed for PR descriptions and
// for verifying that a coverage-focused PR actually moved the needle.
//
// Usage:
//   node scripts/coverage/diff-against-baseline.mjs [--no-build]
//
// Exit code:
//   0  baseline is missing or no regression detected
//   1  current run regressed below the baseline on lines or functions

import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const baselinePath = resolve(repoRoot, 'coverage/baseline.json');
const summaryPath = resolve(repoRoot, 'coverage/report/coverage-summary.json');

// 1. Make sure we have a current summary to compare against.
if (!existsSync(summaryPath)) {
  console.log('[diff] no current coverage/report/coverage-summary.json; running c8 first...');
  const result = spawnSync('node', ['./scripts/coverage/run-c8.mjs', ...process.argv.slice(2)], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
if (!existsSync(summaryPath)) {
  console.error('[diff] current summary still missing; aborting');
  process.exit(1);
}

// 2. No baseline saved → just print totals and exit clean.
if (!existsSync(baselinePath)) {
  console.log('[diff] no baseline.json found; printing current totals only.');
  const cur = JSON.parse(readFileSync(summaryPath, 'utf8'));
  const { lines, statements, functions, branches } = cur.total;
  console.log(`  lines:      ${lines.pct}%`);
  console.log(`  statements: ${statements.pct}%`);
  console.log(`  functions:  ${functions.pct}%`);
  console.log(`  branches:   ${branches.pct}%`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));
const current = JSON.parse(readFileSync(summaryPath, 'utf8'));

function pctDelta(prev, next) {
  const a = prev?.pct ?? 0;
  const b = next?.pct ?? 0;
  const d = b - a;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(2)}`;
}

// 3. Top-level summary delta.
const t = current.total;
const b = baseline.total;
console.log('\n[diff] overall totals (current vs baseline):');
console.log(`  lines:      ${t.lines.pct}%  (Δ ${pctDelta(b.lines, t.lines)} pp)`);
console.log(`  statements: ${t.statements.pct}%  (Δ ${pctDelta(b.statements, t.statements)} pp)`);
console.log(`  functions:  ${t.functions.pct}%  (Δ ${pctDelta(b.functions, t.functions)} pp)`);
console.log(`  branches:   ${t.branches.pct}%  (Δ ${pctDelta(b.branches, t.branches)} pp)`);

// 4. Per-file delta (sorted by absolute Δlines descending).
const rows = [];
for (const file of Object.keys(current)) {
  if (file === 'total') continue;
  const a = baseline[file];
  const cur = current[file];
  if (!a || !cur) continue;
  const dLines = cur.lines.pct - a.lines.pct;
  const dFuncs = cur.functions.pct - a.functions.pct;
  rows.push({ file, dLines, dFuncs, curLines: cur.lines.pct, curFuncs: cur.functions.pct });
}
rows.sort((x, y) => Math.abs(y.dLines) - Math.abs(x.dLines));

console.log('\n[diff] top 30 files by |Δlines|:');
console.log('  ' + 'file'.padEnd(70) + ' Δlines  Δfuncs  curL%  curF%');
console.log('  ' + '-'.repeat(98));
for (const r of rows.slice(0, 30)) {
  const file = r.file.length > 70 ? '…' + r.file.slice(-69) : r.file;
  console.log(
    '  ' + file.padEnd(70) +
    ` ${(r.dLines >= 0 ? '+' : '') + r.dLines.toFixed(2).padStart(6)}` +
    `  ${(r.dFuncs >= 0 ? '+' : '') + r.dFuncs.toFixed(2).padStart(6)}` +
    `  ${r.curLines.toFixed(2).padStart(6)}` +
    `  ${r.curFuncs.toFixed(2).padStart(6)}`,
  );
}

// 5. Regression guard: emit non-zero exit if total lines or functions dropped
//    by more than 0.1 pp (small noise from process scheduling is acceptable).
const linesRegression = t.lines.pct - b.lines.pct < -0.1;
const funcsRegression = t.functions.pct - b.functions.pct < -0.1;
if (linesRegression || funcsRegression) {
  console.error('\n[diff] REGRESSION detected on lines or functions');
  process.exit(1);
}
console.log('\n[diff] no regression detected.');