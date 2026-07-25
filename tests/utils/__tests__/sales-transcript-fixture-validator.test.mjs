import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSalesTranscriptFixture } from '../sales-transcript-fixture-validator.mjs';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('rejects fixture missing required top-level keys', () => {
  const dir = mkdtempSync(join(tmpdir(), 'validator-'));
  const file = join(dir, 'bad.json');
  writeFileSync(file, JSON.stringify({ id: 'x' }));
  const result = validateSalesTranscriptFixture(file);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('speakers')));
});
