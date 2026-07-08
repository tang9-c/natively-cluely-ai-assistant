import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const root = process.cwd();
const require = createRequire(import.meta.url);

test('jszip is a direct app dependency for QA report export', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.dependencies.jszip, '^3.10.1');
  const JSZip = require('jszip');
  assert.equal(typeof JSZip, 'function');
});
