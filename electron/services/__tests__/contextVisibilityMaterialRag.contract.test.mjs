import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('database migrations define answer trace, quality event, and material RAG tables through v26', () => {
  const source = read('electron/db/DatabaseManager.ts');

  assert.match(source, /PRAGMA user_version|user_version/);
  assert.match(source, /answer_context_traces/);
  assert.match(source, /answer_quality_events/);
  assert.match(source, /knowledge_materials/);
  assert.match(source, /knowledge_material_chunks/);
  assert.match(source, /material_embedding_queue/);
  assert.match(source, /user_version\s*=\s*26/);
});

test('renderer contract exposes context trace and material library APIs', () => {
  const types = read('src/types/electron.d.ts');
  const preload = read('electron/preload.ts');

  for (const source of [types, preload]) {
    assert.match(source, /trackAnswerQualityEvent/);
    assert.match(source, /getContextHealth/);
    assert.match(source, /knowledgeSelectMaterials/);
    assert.match(source, /knowledgeUploadMaterials/);
    assert.match(source, /knowledgeListMaterials/);
    assert.match(source, /knowledgeDeleteMaterial/);
    assert.match(source, /knowledgeReindexMaterial/);
  }

  assert.match(types, /answerId\??:/);
  assert.match(types, /contextTrace\??:/);
  assert.match(types, /citations\??:/);
  assert.match(types, /degradedReason\??:/);
});

test('material upload intentionally excludes PPTX and image OCR from the supported formats', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const materialService = read('electron/services/knowledge/KnowledgeMaterialService.ts');

  assert.match(materialService, /Supported formats: PDF, DOCX, TXT, MD/);
  assert.match(materialService, /SUPPORTED_EXTENSIONS/);
  assert.doesNotMatch(materialService, /'\.pptx'|"\.pptx"/i);
  assert.match(ipc, /extensions:\s*\[[^\]]*'pdf'[^\]]*'docx'[^\]]*'txt'[^\]]*'md'[^\]]*\]/s);
  assert.doesNotMatch(ipc, /knowledgeSelectMaterials[\s\S]{0,500}pptx/i);
});

test('RAG retrieval combines lexical and vector scoring and does not treat chunk offset as wall-clock recency', () => {
  const retriever = read('electron/rag/RAGRetriever.ts');
  const vectorStore = read('electron/rag/VectorStore.ts');

  assert.match(retriever, /HYBRID_LEXICAL_WEIGHT\s*=\s*0\.4/);
  assert.match(retriever, /HYBRID_VECTOR_WEIGHT\s*=\s*0\.6/);
  assert.match(retriever, /buildRetrievalQuery/);
  assert.match(retriever, /lexicalScore/);
  assert.match(vectorStore, /searchLexical/);
  assert.doesNotMatch(retriever, /now\s*-\s*chunk\.startMs/);
  assert.match(retriever, /meetingStartTimeMs|meetingCreatedAtMs|absoluteStartMs/);
});
