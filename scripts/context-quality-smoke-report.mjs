#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const modulePath = path.join(root, 'dist-electron/electron/services/eval/ContextQualityDiagnostics.js');
const { summarizeContextQualityDiagnostics } = await import(pathToFileURL(modulePath).href);

function readInput() {
  const inputPath = process.argv[2];
  if (!inputPath) return {};
  const absolutePath = path.resolve(root, inputPath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return JSON.parse(raw);
}

const summary = summarizeContextQualityDiagnostics(readInput());
console.log(JSON.stringify({
  status: 'ok',
  summary,
}, null, 2));
