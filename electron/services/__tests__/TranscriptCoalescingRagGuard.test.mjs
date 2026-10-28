import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import ts from 'typescript';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const mainSource = fs.readFileSync(path.join(repoRoot, 'electron/main.ts'), 'utf8');

test('main feeds every final fragment to live RAG without replaying merged prefixes', () => {
  const anchor = mainSource.indexOf('private routeTranscriptPayload');
  assert.ok(anchor >= 0, 'shared transcript route should feed live RAG');
  const tree = ts.createSourceFile('main.ts', mainSource, ts.ScriptTarget.Latest, true);
  const cls = tree.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'AppState');
  const block = cls.members.find(node => node.name?.getText(tree) === 'routeTranscriptPayload').getText(tree);

  assert.match(block, /routedPayload\.final\s*&&\s*this\.ragManager/);
  assert.doesNotMatch(block, /!transcriptResult\?\.mergedIntoPrevious/);
  assert.match(block, /speaker: routedPayload\.speaker,[\s\S]*text: routedPayload\.text/);
  assert.match(block, /feedLiveTranscript/);
});
