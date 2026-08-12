#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const topLimit = Number.parseInt(process.env.NATIVELY_SIZE_AUDIT_LIMIT || '30', 10);

function readOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const auditPath = path.resolve(readOption('--path') || releaseDir);
const jsonOutput = process.argv.includes('--json');
const minBytesOption = readOption('--min-bytes');
const maxBytesOption = readOption('--max-bytes');
const minBytes = minBytesOption == null ? null : Number.parseInt(minBytesOption, 10);
const maxBytes = maxBytesOption == null ? null : Number.parseInt(maxBytesOption, 10);

if (minBytes != null && (!Number.isFinite(minBytes) || minBytes < 0)) {
  console.error(`[size-audit] Invalid --min-bytes value: ${minBytesOption}`);
  process.exit(1);
}
if (maxBytes != null && (!Number.isFinite(maxBytes) || maxBytes < 0)) {
  console.error(`[size-audit] Invalid --max-bytes value: ${maxBytesOption}`);
  process.exit(1);
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function walk(targetPath, entries) {
  let stat;
  try {
    stat = fs.lstatSync(targetPath);
  } catch {
    return 0;
  }

  if (stat.isSymbolicLink()) {
    entries.push({ path: targetPath, size: 0, type: 'symlink' });
    return 0;
  }

  if (!stat.isDirectory()) {
    entries.push({ path: targetPath, size: stat.size, type: 'file' });
    return stat.size;
  }

  let total = 0;
  for (const child of fs.readdirSync(targetPath)) {
    total += walk(path.join(targetPath, child), entries);
  }

  entries.push({ path: targetPath, size: total, type: 'dir' });
  return total;
}

function printSection(title, rows) {
  console.log('');
  console.log(title);
  console.log('-'.repeat(title.length));

  if (rows.length === 0) {
    console.log('(none)');
    return;
  }

  for (const row of rows) {
    const rel = path.relative(rootDir, row.path) || '.';
    console.log(`${formatBytes(row.size).padStart(10)}  ${row.type.padEnd(4)}  ${rel}`);
  }
}

function classifyPackagedFile(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  if (/(^|\/)Contents\/Frameworks\//.test(normalized)) return 'framework';
  if (/(^|\/)Contents\/Resources\/app\.asar\.unpacked\//.test(normalized)) return 'unpackedNative';
  if (/(^|\/)Contents\/Resources\/app\.asar$/.test(normalized)) return 'asar';
  if (/(^|\/)Contents\/Resources\/models\//.test(normalized)) return 'models';
  if (/(^|\/)Contents\/Resources\/assets\//.test(normalized)) return 'assets';
  if (/(^|\/)Contents\/Resources\/fonts\//.test(normalized)) return 'fonts';
  return 'other';
}

if (!fs.existsSync(auditPath)) {
  console.error(`[size-audit] Missing audit path: ${auditPath}`);
  process.exit(1);
}

const entries = [];
const total = walk(auditPath, entries);
const categories = {
  framework: 0,
  asar: 0,
  unpackedNative: 0,
  models: 0,
  assets: 0,
  fonts: 0,
  other: 0,
};
for (const entry of entries) {
  if (entry.type !== 'file') continue;
  categories[classifyPackagedFile(path.relative(auditPath, entry.path))] += entry.size;
}
const sorted = entries
  .filter((entry) => entry.path !== auditPath)
  .sort((a, b) => b.size - a.size)
  .slice(0, topLimit);

const rootArtifacts = fs.lstatSync(auditPath).isDirectory()
  ? fs.readdirSync(auditPath).map((name) => {
      const artifactPath = path.join(auditPath, name);
      const stat = fs.lstatSync(artifactPath);
      return {
        path: artifactPath,
        size: stat.isDirectory()
          ? entries.find((entry) => entry.path === artifactPath)?.size || 0
          : stat.size,
        type: stat.isDirectory() ? 'dir' : 'file',
      };
    }).sort((a, b) => b.size - a.size)
  : [];

if (jsonOutput) {
  console.log(JSON.stringify({
    generatedAt: new Date().toISOString(),
    auditPath,
    totalBytes: total,
    minBytes,
    maxBytes,
    withinBudget: (minBytes == null || total >= minBytes) && (maxBytes == null || total <= maxBytes),
    categories,
    rootArtifacts: rootArtifacts.map(entry => ({
      path: path.relative(auditPath, entry.path),
      size: entry.size,
      type: entry.type,
    })),
    largestPaths: sorted.map(entry => ({
      path: path.relative(auditPath, entry.path),
      size: entry.size,
      type: entry.type,
    })),
  }, null, 2));
} else {
  console.log('Natively release size audit');
  console.log(`Generated at: ${new Date().toISOString()}`);
  console.log(`Audit path: ${auditPath}`);
  console.log(`Total footprint: ${formatBytes(total)}`);
  console.log(`Categories: ${Object.entries(categories).map(([name, bytes]) => `${name}=${formatBytes(bytes)}`).join(', ')}`);

  printSection('Root artifacts', rootArtifacts);
  printSection(`Largest ${topLimit} packaged paths`, sorted);
}

if (minBytes != null && total < minBytes) {
  console.error(`[size-audit] Footprint ${total} is below budget ${minBytes}`);
  process.exit(2);
}
if (maxBytes != null && total > maxBytes) {
  console.error(`[size-audit] Footprint ${total} exceeds budget ${maxBytes}`);
  process.exit(2);
}
