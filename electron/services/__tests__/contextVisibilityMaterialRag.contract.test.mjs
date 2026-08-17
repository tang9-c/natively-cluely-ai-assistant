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

test('material upload exposes PPTX content extraction behind QCLOUD availability gate', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const materialService = read('electron/services/knowledge/KnowledgeMaterialService.ts');
  const settings = read('src/components/settings/KnowledgeMaterialsSettings.tsx');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(materialService, /SUPPORTED_EXTENSIONS/);
  assert.match(materialService, /'\.pptx'|"\.pptx"/i);
  assert.match(ipc, /knowledge:check-qcloud-availability/);
  assert.match(preload, /knowledgeCheckQCloudAvailability/);
  assert.match(types, /knowledgeCheckQCloudAvailability/);
  assert.doesNotMatch(ipc, /knowledge:get-slide-image/);
  assert.match(ipc, /extensions:\s*\[[^\]]*'pdf'[^\]]*'docx'[^\]]*'txt'[^\]]*'md'[^\]]*'markdown'[^\]]*'pptx'[^\]]*\]/s);
  assert.doesNotMatch(ipc, /extensions:\s*\[[^\]]*'ppt'(?:,|\s*\])/i);
  assert.doesNotMatch(ipc, /extensions:\s*\[[^\]]*'pptm'(?:,|\s*\])/i);
  assert.match(settings, /PPTX 需要先配置并选择 QCLOUD API；旧版 \.ppt 不支持。/);
  assert.match(settings, /explainMaterialStatus/);
  assert.match(settings, /explanation\.label/);
  assert.match(settings, /explanation\.message/);
  assert.match(settings, /embeddingStatus === 'failed'/);
  assert.match(settings, /语义检索暂不可用。CueUp 会对上传资料使用关键词匹配。/);
  assert.match(settings, /embeddingStatus === 'initializing'/);
  assert.match(settings, /语义检索正在初始化，完成后将自动启用。/);
  assert.doesNotMatch(settings, /embeddingReady === false/);
  assert.match(settings, /materialEmbeddingFailed/);
  assert.match(settings, /部分资料文本可用，但语义索引失败。CueUp 仍可尝试关键词匹配。/);
  assert.match(settings, /summarizeUploadResult/);
  assert.match(settings, /material\.status === 'failed'/);
  assert.match(settings, /const canReindex = explanation\.canReindex/);
  assert.match(settings, /onClick=\{uploadMaterials\}/);
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
  const contribution = read('electron/services/knowledge/UploadedMaterialContextContributionService.ts');
  const materialService = read('electron/services/knowledge/KnowledgeMaterialService.ts');
  const retriever = read('electron/services/knowledge/MaterialRagRetriever.ts');
  const db = read('electron/db/DatabaseManager.ts');

  assert.match(materialService, /searchWithDiagnostics/);
  assert.match(ipc, /buildUploadedMaterialContextContribution/);
  assert.match(contribution, /const materialSearch = await input\.materialService\.searchWithDiagnostics/);
  assert.match(contribution, /materialSearch\.degradedReason[\s\S]{0,160}embedding_unavailable/);
  assert.match(retriever, /throw new Error\('missing_chunk_embedding_failed'\)/);
  assert.match(db, /markKnowledgeMaterialEmbeddingsFailed/);
});

test('context health waits briefly for async embedding initialization before reporting unavailable', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ipc, /EMBEDDING_READY_STATUS_WAIT_MS/);
  assert.match(ipc, /waitForEmbeddingReadiness/);
  assert.match(ipc, /embeddingPipeline\.waitForReady\(EMBEDDING_READY_STATUS_WAIT_MS\)/);
  assert.match(ipc, /async function getRagReadiness/);
  assert.match(ipc, /embeddingStatus/);
  assert.match(ipc, /getStatus/);
  assert.match(types, /export type EmbeddingHealthStatus\s*=\s*'idle'\s*\|\s*'initializing'\s*\|\s*'ready'\s*\|\s*'failed'/);
  assert.match(types, /embeddingStatus:\s*EmbeddingHealthStatus/);
  assert.match(ipc, /const \{ ragReady, embeddingReady \} = await getRagReadiness\(ragManagerForHealth\)/);
  assert.match(ipc, /const \{ ragReady, embeddingReady, embeddingStatus \} = await getRagReadiness\(ragManager\)/);
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
