import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('exposes a local-only performance baseline command', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));

  assert.equal(
    packageJson.scripts['benchmark:performance'],
    'node scripts/run-performance-baseline.mjs',
  );
});
