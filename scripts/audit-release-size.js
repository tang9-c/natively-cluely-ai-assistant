#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const releaseDir = path.join(rootDir, 'release');
const topLimit = Number.parseInt(process.env.NATIVELY_SIZE_AUDIT_LIMIT || '30', 10);

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

if (!fs.existsSync(releaseDir)) {
  console.error(`[size-audit] Missing release directory: ${releaseDir}`);
  process.exit(1);
}

const entries = [];
const total = walk(releaseDir, entries);
const sorted = entries
  .filter((entry) => entry.path !== releaseDir)
  .sort((a, b) => b.size - a.size)
  .slice(0, topLimit);

console.log('Natively release size audit');
console.log(`Generated at: ${new Date().toISOString()}`);
console.log(`Release directory: ${releaseDir}`);
console.log(`Total release footprint: ${formatBytes(total)}`);

printSection('Release root artifacts', fs.readdirSync(releaseDir)
  .map((name) => {
    const artifactPath = path.join(releaseDir, name);
    const stat = fs.lstatSync(artifactPath);
    return {
      path: artifactPath,
      size: stat.isDirectory()
        ? entries.find((entry) => entry.path === artifactPath)?.size || 0
        : stat.size,
      type: stat.isDirectory() ? 'dir' : 'file',
    };
  })
  .sort((a, b) => b.size - a.size));

printSection(`Largest ${topLimit} packaged paths`, sorted);
