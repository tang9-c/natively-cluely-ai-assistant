import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relPath) {
  return fs.readFileSync(path.join(repoRoot, relPath), 'utf8');
}

test('research UI shares the current six-dimension dossier contract', () => {
  const shared = read('shared/companyResearch.ts');
  const panel = read('src/components/research/ResearchPanel.tsx');

  for (const key of [
    'financials',
    'business',
    'strategy',
    'people',
    'infrastructure',
    'procurement',
  ]) {
    assert.match(shared, new RegExp(`['\"]${key}['\"]`));
  }

  assert.match(panel, /COMPANY_RESEARCH_DIMENSION_KEYS/);
  assert.doesNotMatch(panel, /\(r\.dossier as any\)\[d\.key\]/);
});

test('research IPC and hook use the shared typed response', () => {
  const preload = read('electron/preload.ts');
  const rendererTypes = read('src/types/electron.d.ts');
  const hook = read('src/hooks/useResearch.ts');

  assert.match(preload, /ProfileResearchCompanyResponse/);
  assert.match(rendererTypes, /ProfileResearchCompanyResponse/);
  assert.match(hook, /ProfileResearchCompanyResponse/);
  assert.doesNotMatch(hook, /interface Dossier/);
  assert.doesNotMatch(hook, /interface ResearchResponse/);
});
