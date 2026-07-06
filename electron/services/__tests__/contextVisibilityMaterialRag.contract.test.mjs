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
  const settings = read('src/components/settings/KnowledgeMaterialsSettings.tsx');

  assert.match(materialService, /支持 PDF、DOCX、Markdown 和 TXT|Supported formats: PDF, DOCX, TXT, MD/);
  assert.match(materialService, /SUPPORTED_EXTENSIONS/);
  assert.doesNotMatch(materialService, /'\.pptx'|"\.pptx"/i);
  assert.match(ipc, /extensions:\s*\[[^\]]*'pdf'[^\]]*'docx'[^\]]*'txt'[^\]]*'md'[^\]]*\]/s);
  assert.doesNotMatch(ipc, /knowledgeSelectMaterials[\s\S]{0,500}pptx/i);
  assert.match(settings, /PPTX 即将支持；当前请先导出为 PDF 或 Markdown 后上传。/);
  assert.match(settings, /queued:\s*'排队中'/);
  assert.match(settings, /indexing:\s*'索引中'/);
  assert.match(settings, /complete:\s*'已完成'/);
  assert.match(settings, /failed:\s*'索引失败'/);
  assert.match(settings, /embeddingReady === false/);
  assert.match(settings, /资料仍可上传，但检索将降级为关键词匹配，回答可能不稳定。/);
  assert.match(settings, /materialEmbeddingFailed/);
  assert.match(settings, /部分资料的向量索引失败；资料仍可检索，但会降级为关键词匹配。/);
  assert.match(settings, /summarizeUploadResult/);
  assert.match(settings, /material\.status === 'failed'/);
  assert.match(settings, /const canReindex = materialStatus === 'complete'/);
  assert.match(settings, /disabled=\{busy \|\| !canReindex\}/);
});

test('material upload creates records before background indexing can finish', () => {
  const materialService = read('electron/services/knowledge/KnowledgeMaterialService.ts');
  const ipc = read('electron/ipcHandlers.ts');
  const settings = read('src/components/settings/KnowledgeMaterialsSettings.tsx');

  assert.match(materialService, /createMaterialRecord\(filePath\)/);
  assert.match(materialService, /enqueueIndexMaterialFromFile/);
  assert.match(materialService, /cancelledMaterialIds/);
  assert.match(materialService, /isMaterialIndexable/);
  assert.match(materialService, /status:\s*'queued'/);
  assert.match(materialService, /status:\s*'failed'/);
  assert.match(materialService, /errorCode:\s*'unsupported_file_type'/);
  assert.match(ipc, /await service\.uploadFiles\(filePaths\)/);
  assert.match(settings, /startUploadPolling/);
  assert.match(settings, /isBatchSettled/);
});

test('material RAG diagnostics propagate embedding fallback into realtime answer trace', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const materialService = read('electron/services/knowledge/KnowledgeMaterialService.ts');
  const retriever = read('electron/services/knowledge/MaterialRagRetriever.ts');
  const db = read('electron/db/DatabaseManager.ts');

  assert.match(materialService, /searchWithDiagnostics/);
  assert.match(ipc, /const materialSearch = await materialService\.searchWithDiagnostics/);
  assert.match(ipc, /materialSearch\.degradedReason[\s\S]{0,160}embedding_unavailable/);
  assert.match(retriever, /throw new Error\('missing_chunk_embedding_failed'\)/);
  assert.match(db, /markKnowledgeMaterialEmbeddingsFailed/);
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
