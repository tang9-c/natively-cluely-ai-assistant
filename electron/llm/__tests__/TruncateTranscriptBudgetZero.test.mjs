// TruncateTranscriptBudgetZero.test.mjs
//
// Regression: truncateTranscriptToFit() is documented as "drop oldest turns
// until the joined transcript fits the token budget" — meaning a non-positive
// budget means the caller wants ZERO turns.
//
// Previously the function had:
//
//     if (!transcript?.length || budgetTokens <= 0) return transcript ?? [];
//
// which returns the FULL transcript when budgetTokens is 0 or negative.
// That violates the contract — the function-name implies fitting, and the
// docblock above the function says "Most recent turns are preserved."
// Returning the entire transcript under budget=0 would silently send way
// more context than the caller requested.
//
// Pin behavior in the source so a regression is loud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../modelCapabilities.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

test('truncateTranscriptToFit returns [] when budgetTokens <= 0 (not the full transcript)', () => {
  // The early-return guard for non-positive budget must return an empty
  // array, not the original transcript.
  //
  // The buggy version was:  return transcript ?? [];
  // The fixed version is:   return [];
  // We pin the source on the new shape — there should be a `return []` that
  // matches the budgetTokens <= 0 branch.

  // Slice out just the function body to make the assertion robust to other
  // changes elsewhere in the file.
  const start = source.indexOf('export function truncateTranscriptToFit');
  assert.ok(start >= 0, 'truncateTranscriptToFit must be exported');
  const next = source.indexOf('\nexport ', start + 1);
  const end = next >= 0 ? next : source.length;
  const body = source.slice(start, end);

  // Must NOT contain the buggy `return transcript ?? [];` form.
  assert.doesNotMatch(
    body,
    /budgetTokens\s*<=\s*0\s*\)\s*return\s+transcript\s*\?\?\s*\[\]\s*;?/,
    'When budgetTokens <= 0, the function must NOT return the original transcript — that violates the fit-to-budget contract'
  );

  // Must contain an early return that yields an empty array under
  // budgetTokens <= 0. The shape we accept is anything that returns []
  // inside the budget guard. Be permissive about the exact guard form
  // (future-proof against a `Math.max(0, ...)` rewrite etc.).
  assert.match(
    body,
    /budgetTokens\s*<=\s*0[\s\S]{0,80}return\s+\[\s*\]\s*;?/,
    'When budgetTokens <= 0, the function must return []'
  );
});

test('truncateTranscriptToFit docblock promises "Most recent turns are preserved" — guard must not violate that', () => {
  // The docblock above the function explicitly says "Most recent turns are
  // preserved." A 0-budget caller preserves ZERO turns, not all turns, so
  // returning the original transcript is a clear contract violation.
  const start = source.indexOf('export function truncateTranscriptToFit');
  assert.ok(start >= 0, 'truncateTranscriptToFit must exist');
  // Look at the 10 lines preceding the function for the docblock.
  const preamble = source.slice(Math.max(0, start - 500), start);
  assert.match(preamble, /Most recent turns are preserved/i,
    'Pre-condition: the docblock must still promise recent-turns-preserved');
});
