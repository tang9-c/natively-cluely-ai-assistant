#!/usr/bin/env node
// Snapshot the current coverage summary as the project baseline so future runs
// can be diffed against it via diff-against-baseline.mjs.
//
// Usage:
//   node scripts/coverage/baseline.mjs [--no-build]

import { spawnSync } from 'node:child_process';

const args = ['./scripts/coverage/run-c8.mjs', '--baseline', ...process.argv.slice(2)];
const result = spawnSync('node', args, { stdio: 'inherit' });
process.exit(result.status ?? 1);