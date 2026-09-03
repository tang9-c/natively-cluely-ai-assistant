import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);
const contextPath = path.resolve(
  __dirname,
  '../../../../dist-electron/electron/services/research/CompanyResearchContext.js',
);

function makeDossier(text = '摘要') {
  const dimension = {
    summary: text,
    details: [{ text: `${text}详情`, citation: 1 }],
    confidence: 'high',
  };
  return {
    schemaVersion: '1.0',
    companyName: 'Acme <script>',
    generatedAt: '2026-09-03T00:00:00.000Z',
    expiresAt: '2099-01-01T00:00:00.000Z',
    source: 'tavily',
    financials: dimension,
    business: dimension,
    strategy: dimension,
    people: dimension,
    infrastructure: dimension,
    procurement: dimension,
    sources: [{
      index: 1,
      title: '可信来源 <标题>',
      url: 'https://example.com/?a=1&b=2',
      snippet: '不得进入上下文的网页原文',
    }],
  };
}

test('builds guarded evidence from the six dimensions and trusted source metadata', () => {
  const { buildCompanyResearchEvidence } = cjsRequire(contextPath);
  const output = buildCompanyResearchEvidence(makeDossier());

  for (const key of [
    'financials', 'business', 'strategy', 'people', 'infrastructure', 'procurement',
  ]) {
    assert.match(output, new RegExp(`dimension name="${key}"`));
  }
  assert.match(output, /untrusted_external_evidence/);
  assert.match(output, /可信来源 &lt;标题&gt;/);
  assert.match(output, /https:\/\/example\.com\/\?a=1&amp;b=2/);
  assert.doesNotMatch(output, /不得进入上下文的网页原文/);
  assert.doesNotMatch(output, /<script>/);
});

test('never exceeds the requested character budget', () => {
  const { buildCompanyResearchEvidence } = cjsRequire(contextPath);
  const output = buildCompanyResearchEvidence(makeDossier('很长'.repeat(1000)), 900);

  assert.ok(output.length > 0);
  assert.ok(output.length <= 900, `expected <= 900 chars, got ${output.length}`);
  assert.match(output, /<\/company_research_evidence>$/);
});
