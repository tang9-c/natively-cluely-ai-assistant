import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(__dirname, '../../LLMHelper.ts');
const source = fs.readFileSync(sourcePath, 'utf8');

describe('LLMHelper scenario context injection', () => {
  test('uses one helper to apply knowledge result context and scopes', () => {
    assert.match(source, /private applyKnowledgeResultToRequest\(/);
    assert.match(source, /knowledgeResult\.systemPromptInjection/);
    assert.match(source, /knowledgeResult\.contextBlock/);
    assert.match(source, /knowledgeResult\.dataScopes/);
  });

  test('chatWithGemini passes scenario data scopes into provider scope filtering', () => {
    assert.match(source, /let knowledgeDataScopes: ProviderDataScope\[\] = \[\]/);
    assert.match(source, /knowledgeDataScopes = appliedKnowledge\.extraDataScopes/);
    assert.match(source, /\.\.\.knowledgeDataScopes,\s*\.\.\.this\.inferContextScopes\(context\)/);
  });

  test('streamChat uses the shared helper and omits denied scenario context scopes', () => {
    assert.match(source, /extraDataScopes = \[\.\.\.extraDataScopes, \.\.\.appliedKnowledge\.extraDataScopes\]/);
    assert.match(source, /scope === 'reference_files'/);
    assert.match(source, /scope === 'profile_history'/);
    assert.match(source, /scope === 'post_call_summary'/);
  });
});
