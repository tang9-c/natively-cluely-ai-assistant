#!/usr/bin/env node
// annotate-ipc-channels.mjs
//
// One-shot tool: read every safeHandle('xxx', ...) in electron/ipcHandlers.ts,
// infer the corresponding renderer-side API name (camelCase), find the matching
// line in src/types/electron.d.ts, and insert "// @ipc-channel xxx" above it.
//
// Usage:
//   node scripts/annotate-ipc-channels.mjs --dry-run   # print plan, no edits
//   node scripts/annotate-ipc-channels.mjs --apply     # edit types file in place
//
// Channel → API name inference rules (matching the existing 16 contract tests):
//   1. split by ":" → [namespace?, local?]
//   2. kebab-to-camel on namespace (e.g. "speaker-verification" → "speakerVerification")
//   3. kebab-to-camel on local, capitalized (e.g. "get-meeting-active" → "get" + "MeetingActive")
//   4. final API name = namespaceCamel + localCamelCapitalized
//      e.g. "speaker-verification:enroll" → "speakerVerification" + "Enroll" → "speakerVerificationEnroll"
//      e.g. "get-meeting-active" → "" + "getMeetingActive" → "getMeetingActive"

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const ipcPath = path.join(repoRoot, 'electron/ipcHandlers.ts');
const preloadPath = path.join(repoRoot, 'electron/preload.ts');
const typesPath = path.join(repoRoot, 'src/types/electron.d.ts');

function kebabToCamel(s, capitalizeFirst) {
  const parts = s.split('-');
  return parts
    .map((p, i) => {
      if (i === 0 && !capitalizeFirst) return p;
      return p.charAt(0).toUpperCase() + p.slice(1);
    })
    .join('');
}

function channelToApiName(channel) {
  if (channel.includes(':')) {
    const [ns, local] = channel.split(':');
    return kebabToCamel(ns, false) + kebabToCamel(local, true);
  }
  return kebabToCamel(channel, false);
}

function extractChannels(ipcSource) {
  const re = /safeHandle\(\s*['"]([^'"]+)['"]/g;
  const channels = new Set();
  let m;
  while ((m = re.exec(ipcSource)) !== null) channels.add(m[1]);
  return [...channels].sort();
}

function extractPreloadInvokeMap(preloadSource) {
  const map = new Map();
  const lines = preloadSource.split(/\r?\n/);
  const channelRe = /ipcRenderer\.invoke\(\s*['"]([^'"]+)['"]/;
  const apiLineRe = /^ {2}([A-Za-z_$][\w$]*)\s*:/;

  for (let i = 0; i < lines.length; i++) {
    const channelMatch = channelRe.exec(lines[i]);
    if (!channelMatch) continue;

    for (let j = i; j >= 0 && j >= i - 20; j--) {
      const apiMatch = apiLineRe.exec(lines[j]);
      if (!apiMatch) continue;
      if (!map.has(channelMatch[1])) map.set(channelMatch[1], apiMatch[1]);
      break;
    }
  }
  return map;
}

function findApiLine(typesSource, apiName) {
  // Match either "apiName: " (camelCase / PascalCase) at the start of a property
  // declaration. Skip if the line is inside a comment (//) — handle heuristically.
  const lines = typesSource.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trimStart().startsWith('//')) continue;
    // property declaration form: "  apiName: ..." or "  apiName<...>: ..."
    const re = new RegExp(`^\\s+(${apiName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:<[^>]+>)?\\s*[:(]`);
    if (re.test(line)) return { lineNumber: i + 1, line };
  }
  return null;
}

function alreadyAnnotated(typesSource, channel) {
  return new RegExp(`@ipc-channel\\s+${channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(typesSource);
}

function main() {
  const mode = process.argv.includes('--apply') ? 'apply' : 'dry-run';
  const ipc = fs.readFileSync(ipcPath, 'utf8');
  const preload = fs.readFileSync(preloadPath, 'utf8');
  const types = fs.readFileSync(typesPath, 'utf8');

  const channels = extractChannels(ipc);
  const preloadApiByChannel = extractPreloadInvokeMap(preload);
  const lines = types.split(/\r?\n/);

  const plan = [];
  for (const channel of channels) {
    const apiName = preloadApiByChannel.get(channel) || channelToApiName(channel);
    const found = findApiLine(types, apiName);
    const annotated = alreadyAnnotated(types, channel);
    plan.push({ channel, apiName, found: found ? found.lineNumber : null, annotated });
  }

  const matched = plan.filter((p) => p.found !== null);
  const unmatched = plan.filter((p) => p.found === null);
  const toAnnotate = matched.filter((p) => !p.annotated);
  const alreadyDone = matched.filter((p) => p.annotated);

  console.log(`Mode: ${mode}`);
  console.log(`Total channels in ipcHandlers.ts: ${plan.length}`);
  console.log(`  matched an API in types: ${matched.length}`);
  console.log(`  unmatched (no API name found in types): ${unmatched.length}`);
  console.log(`  already annotated: ${alreadyDone.length}`);
  console.log(`  to annotate: ${toAnnotate.length}`);
  console.log('');

  if (unmatched.length > 0) {
    console.log('=== UNMATCHED channels (no API in types) ===');
    for (const u of unmatched) console.log(`  ${u.channel}  (inferred: ${u.apiName})`);
    console.log('');
  }

  if (mode === 'dry-run') {
    console.log('=== PLAN: would insert "@ipc-channel <name>" above each: ===');
    for (const p of toAnnotate) console.log(`  types.d.ts:${p.found}  ${p.apiName}  ←  ${p.channel}`);
    console.log('');
    console.log('Re-run with --apply to edit the file.');
    return;
  }

  // APPLY mode: insert annotations in reverse line order so earlier insertions
  // don't shift the line numbers of later ones.
  const insertions = new Map(); // lineNumber → annotation text
  for (const p of toAnnotate) {
    insertions.set(p.found, `  // @ipc-channel ${p.channel}`);
  }
  const sortedLineNumbers = [...insertions.keys()].sort((a, b) => b - a);
  for (const ln of sortedLineNumbers) {
    lines.splice(ln - 1, 0, insertions.get(ln));
  }
  fs.writeFileSync(typesPath, lines.join('\n'));
  console.log(`Applied ${toAnnotate.length} annotations to ${typesPath}`);
}

main();
