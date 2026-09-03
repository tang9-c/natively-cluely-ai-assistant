import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { sliceSafeHandleBlock } from './ipcTestUtils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const extractorSource = fs.readFileSync(
  path.join(root, 'electron/services/profile/DocumentTextExtractor.ts'),
  'utf8',
);
const databaseSource = fs.readFileSync(
  path.join(root, 'electron/db/DatabaseManager.ts'),
  'utf8',
);
const modesSource = fs.readFileSync(
  path.join(root, 'electron/services/ModesManager.ts'),
  'utf8',
);
const orchestratorSource = fs.readFileSync(
  path.join(root, 'electron/services/profile/ProfileOrchestrator.ts'),
  'utf8',
);
const ipcSource = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

describe('profile document performance guards', () => {
  test('document extraction uses asynchronous filesystem reads', () => {
    assert.doesNotMatch(extractorSource, /fs\.readFileSync\(/);
    assert.doesNotMatch(extractorSource, /fs\.lstatSync\(/);
    assert.match(extractorSource, /fs\.promises\.readFile\(/);
    assert.match(extractorSource, /fs\.promises\.lstat\(/);
  });

  test('database exposes a metadata-only reference-file query', () => {
    const methodStart = databaseSource.indexOf('public getReferenceFileSummaries(');
    assert.ok(methodStart >= 0, 'getReferenceFileSummaries must exist');
    const methodTail = databaseSource.slice(methodStart);
    const nextMethod = methodTail.indexOf('\n    public ', 1);
    const method = methodTail.slice(0, nextMethod);
    assert.match(method, /SELECT\s+id,\s*mode_id,\s*file_name,\s*created_at\s+FROM\s+mode_reference_files/s);
    assert.doesNotMatch(method, /SELECT\s+\*/);
    assert.doesNotMatch(method, /\bcontent\b/);
  });

  test('ModesManager keeps summary retrieval separate from full-content retrieval', () => {
    assert.match(modesSource, /public getReferenceFileSummaries\(modeId: string\)/);
  });

  test('profile:list-documents uses summaries and never spreads full reference files', () => {
    const handler = sliceSafeHandleBlock(ipcSource, 'profile:list-documents');
    assert.match(handler, /getReferenceFileSummaries\(mode\.id\)/);
    assert.doesNotMatch(handler, /getReferenceFiles\(mode\.id\)/);
    assert.doesNotMatch(handler, /\.\.\.file/);
  });

  test('resume and JD uploads preserve the explicit oversized-file error', () => {
    assert.match(orchestratorSource, /error\?\.code === 'profile_document_too_large'/);
    assert.match(orchestratorSource, /maximum is 10 MB/);
  });
});
