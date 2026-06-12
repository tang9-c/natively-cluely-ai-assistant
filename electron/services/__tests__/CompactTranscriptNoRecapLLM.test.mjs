// CompactTranscriptNoRecapLLM.test.mjs
//
// Regression: SessionTracker.compactTranscriptIfNeeded() is called when the
// full transcript buffer exceeds 1800 segments. It takes the OLDEST 500
// segments and rolls them into an "epoch summary" stored in
// transcriptEpochSummaries, then evicts those 500 segments from fullTranscript.
//
// Previously, when recapLLM was not yet available (e.g. app startup, or
// recapLLM === null), the code only pushed a marker like
//
//     [Earlier discussion (no LLM): 500 segments summarized without transcript snippets.]
//
// and then EVICTED the 500 original segments. The marker carried no
// information, so the user's earlier meeting context was silently lost.
//
// The fix: the no-LLM fallback must preserve a usable digest of the
// 500 segments in the marker — at minimum the FIRST and LAST few segments
// verbatim, so getFullSessionContext() still returns something useful for
// post-call summary generation. We accept any of:
//   - Embedding first N + last M segments inline in the marker
//   - Truncating to a per-segment length cap and joining inline
//   - Producing a list of segment texts inside the marker
//
// Pin behavior in the source so a regression is loud.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../SessionTracker.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

function extractFunction(name) {
  const start = source.indexOf(`private async ${name}`);
  if (start < 0) throw new Error(`${name} must exist`);
  // Find the next method or class end. Methods are indented with 4 spaces.
  const nextMethod = source.indexOf('\n    private ', start + 1);
  const nextPublic = source.indexOf('\n    public ', start + 1);
  const candidates = [nextMethod, nextPublic].filter(i => i > 0);
  const end = candidates.length ? Math.min(...candidates) : source.length;
  return source.slice(start, end);
}

const body = extractFunction('compactTranscriptIfNeeded');

function extractNoLlmElseBody(src) {
  // Anchor on the canonical comment that the no-LLM branch carries.
  // Robust to template-string brace noise that confuses naive brace counting.
  const anchor = src.indexOf('// BUG-03 fix: recapLLM not yet available');
  if (anchor < 0) throw new Error('no-LLM else branch must exist with BUG-03 fix comment');
  // Walk backwards to find the `} else {` opening this branch.
  const before = src.lastIndexOf('} else {', anchor);
  if (before < 0) throw new Error('no-LLM else branch must be reachable from a `} else {`');
  // Capture up to the next class-level method/closing brace at the same indent.
  const after = src.indexOf('\n            }\n', before);
  return after > 0 ? src.slice(before, after + 14) : src.slice(before, before + 2000);
}

const noLlmBody = extractNoLlmElseBody(body);

test('compactTranscriptIfNeeded no-LLM fallback preserves segment content (not just a count marker)', () => {
  // Must NOT be the buggy pure-marker shape that drops segment content.
  // The buggy version was: marker = `[Earlier discussion (no LLM): 500
  // segments summarized without transcript snippets.]` and the marker
  // does not reference oldEntries anywhere on the right-hand side.
  const noContentMarker = /segments\s+summarized\s+without\s+transcript\s+snippets/;
  assert.doesNotMatch(
    noLlmBody,
    noContentMarker,
    'no-LLM marker must preserve at least some segment content, not just a count'
  );

  // Must reference oldEntries (or summaryInput, which is derived from it)
  // when building the marker so the user's context is not silently lost.
  assert.match(
    noLlmBody,
    /oldEntries|summaryInput/,
    'no-LLM fallback must reference oldEntries (or summaryInput derived from it) to preserve content'
  );
});

test('compactTranscriptIfNeeded no-LLM marker is still pushed to transcriptEpochSummaries', () => {
  // Sanity: the no-LLM branch must still call transcriptEpochSummaries.push(...)
  // — otherwise the whole "summarize" path is dead.
  assert.match(
    noLlmBody,
    /transcriptEpochSummaries\.push\(/,
    'no-LLM branch must still push something into transcriptEpochSummaries'
  );
});
