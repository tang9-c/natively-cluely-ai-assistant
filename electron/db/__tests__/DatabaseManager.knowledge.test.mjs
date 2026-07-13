// DatabaseManager.knowledge.test.mjs
// PR2.3: knowledge_materials / knowledge_material_chunks / material_embedding_queue CRUD.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';

function makeManager() {
  const db = new Database(':memory:');
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.ensuredDims = new Map();
  return { db, manager };
}

function createKnowledgeSchema(db) {
  db.exec(`
    CREATE TABLE knowledge_materials (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      title TEXT,
      mime_or_ext TEXT NOT NULL,
      file_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'indexing', 'complete', 'failed', 'deleted')),
      error_code TEXT,
      error_message TEXT,
      source_type TEXT NOT NULL DEFAULT 'upload',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE knowledge_material_chunks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_id TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      parent_chunk_index INTEGER,
      cleaned_text TEXT NOT NULL,
      parent_text TEXT,
      token_count INTEGER NOT NULL,
      embedding BLOB,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(material_id, chunk_index),
      FOREIGN KEY(material_id) REFERENCES knowledge_materials(id) ON DELETE CASCADE
    );

    CREATE TABLE material_embedding_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      material_chunk_id INTEGER NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
      retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      FOREIGN KEY(material_chunk_id) REFERENCES knowledge_material_chunks(id) ON DELETE CASCADE
    );
  `);
}

describe('DatabaseManager — upsertKnowledgeMaterial / list / get / update status', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createKnowledgeSchema(db);
  });

  it('listKnowledgeMaterials returns [] when none exist', () => {
    assert.deepEqual(manager.listKnowledgeMaterials(), []);
  });

  it('upsertKnowledgeMaterial inserts a new row and returns it', () => {
    const row = manager.upsertKnowledgeMaterial({
      id: 'mat_1',
      fileName: 'spec.pdf',
      title: 'Spec',
      mimeOrExt: 'application/pdf',
      fileHash: 'hash_1',
      status: 'queued',
    });
    assert.ok(row);
    assert.equal(row.id, 'mat_1');
    assert.equal(row.file_name, 'spec.pdf');
    assert.equal(row.title, 'Spec');
    assert.equal(row.status, 'queued');
  });

  it('upsertKnowledgeMaterial falls back to fileName when title is missing', () => {
    const row = manager.upsertKnowledgeMaterial({
      id: 'mat_2',
      fileName: 'notes.md',
      mimeOrExt: 'text/markdown',
      fileHash: 'h2',
    });
    assert.equal(row.title, 'notes.md');
  });

  it('upsertKnowledgeMaterial updates on id conflict', () => {
    manager.upsertKnowledgeMaterial({
      id: 'mat_3',
      fileName: 'a.pdf',
      mimeOrExt: 'pdf',
      fileHash: 'h3',
      status: 'queued',
    });
    manager.upsertKnowledgeMaterial({
      id: 'mat_3',
      fileName: 'a-renamed.pdf',
      mimeOrExt: 'pdf',
      fileHash: 'h3',
      status: 'indexing',
    });
    const count = db.prepare('SELECT COUNT(*) AS c FROM knowledge_materials').get().c;
    assert.equal(count, 1);
    const row = manager.getKnowledgeMaterial('mat_3');
    assert.equal(row.file_name, 'a-renamed.pdf');
    assert.equal(row.status, 'indexing');
  });

  it('getKnowledgeMaterial returns null for an unknown id', () => {
    assert.equal(manager.getKnowledgeMaterial('nope'), null);
  });

  it('updateKnowledgeMaterialStatus transitions status and stores error', () => {
    manager.upsertKnowledgeMaterial({
      id: 'mat_4',
      fileName: 'x.pdf',
      mimeOrExt: 'pdf',
      fileHash: 'h4',
      status: 'queued',
    });
    manager.updateKnowledgeMaterialStatus('mat_4', 'failed', { code: 'E_PARSE', message: 'bad pdf' });
    const row = manager.getKnowledgeMaterial('mat_4');
    assert.equal(row.status, 'failed');
    assert.equal(row.error_code, 'E_PARSE');
    assert.equal(row.error_message, 'bad pdf');
  });

  it('updateKnowledgeMaterialStatus does not resurrect a deleted material', () => {
    manager.upsertKnowledgeMaterial({
      id: 'mat_5',
      fileName: 'x.pdf',
      mimeOrExt: 'pdf',
      fileHash: 'h5',
      status: 'queued',
    });
    manager.deleteKnowledgeMaterial('mat_5');
    manager.updateKnowledgeMaterialStatus('mat_5', 'complete', null);
    // Still considered deleted (the row stays, but with status='deleted').
    const row = manager.getKnowledgeMaterial('mat_5');
    assert.equal(row, null);
  });

  it('listKnowledgeMaterials filters out deleted materials', () => {
    manager.upsertKnowledgeMaterial({ id: 'a', fileName: 'a', mimeOrExt: 'x', fileHash: 'h1', status: 'queued' });
    manager.upsertKnowledgeMaterial({ id: 'b', fileName: 'b', mimeOrExt: 'x', fileHash: 'h2', status: 'complete' });
    manager.deleteKnowledgeMaterial('a');
    const rows = manager.listKnowledgeMaterials();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, 'b');
  });
});

describe('DatabaseManager — replaceKnowledgeMaterialChunks', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createKnowledgeSchema(db);
    manager.upsertKnowledgeMaterial({
      id: 'mat_c',
      fileName: 'c.txt',
      mimeOrExt: 'text/plain',
      fileHash: 'h_c',
      status: 'indexing',
    });
  });

  it('replaces existing chunks for the same material', () => {
    manager.replaceKnowledgeMaterialChunks('mat_c', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
      { chunkIndex: 1, cleanedText: 'B', tokenCount: 1 },
    ]);
    manager.replaceKnowledgeMaterialChunks('mat_c', [
      { chunkIndex: 0, cleanedText: 'A2', tokenCount: 1 },
    ]);
    const rows = db.prepare('SELECT * FROM knowledge_material_chunks WHERE material_id = ? ORDER BY chunk_index').all('mat_c');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cleaned_text, 'A2');
  });

  it('returns the inserted chunk ids', () => {
    const ids = manager.replaceKnowledgeMaterialChunks('mat_c', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
      { chunkIndex: 1, cleanedText: 'B', tokenCount: 1 },
    ]);
    assert.equal(ids.length, 2);
    for (const id of ids) {
      assert.equal(typeof id, 'number');
      assert.ok(id > 0);
    }
  });

  it('queues chunks without embeddings as pending and with embeddings as completed', () => {
    const ids = manager.replaceKnowledgeMaterialChunks('mat_c', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
      { chunkIndex: 1, cleanedText: 'B', tokenCount: 1, embedding: [0.1, 0.2, 0.3] },
    ]);
    const queueRows = db.prepare('SELECT material_chunk_id, status FROM material_embedding_queue ORDER BY material_chunk_id').all();
    const byChunk = new Map(queueRows.map(r => [r.material_chunk_id, r.status]));
    assert.equal(byChunk.get(ids[0]), 'pending');
    assert.equal(byChunk.get(ids[1]), 'completed');
  });

  it('setKnowledgeMaterialChunkEmbedding stores the embedding and marks the queue row completed', () => {
    const [chunkId] = manager.replaceKnowledgeMaterialChunks('mat_c', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
    ]);
    manager.setKnowledgeMaterialChunkEmbedding(chunkId, [0.4, 0.5, 0.6]);
    const row = db.prepare('SELECT * FROM material_embedding_queue WHERE material_chunk_id = ?').get(chunkId);
    assert.equal(row.status, 'completed');
    assert.ok(row.processed_at);
  });
});

describe('DatabaseManager — getKnowledgeMaterialChunks / getKnowledgeMaterialCandidateChunks', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createKnowledgeSchema(db);
    manager.upsertKnowledgeMaterial({ id: 'm1', fileName: 'f1', mimeOrExt: 'pdf', fileHash: 'h1', status: 'complete' });
    manager.upsertKnowledgeMaterial({ id: 'm2', fileName: 'f2', mimeOrExt: 'pdf', fileHash: 'h2', status: 'complete' });
    manager.upsertKnowledgeMaterial({ id: 'm3', fileName: 'f3', mimeOrExt: 'pdf', fileHash: 'h3', status: 'indexing' });
    manager.replaceKnowledgeMaterialChunks('m1', [
      { chunkIndex: 0, cleanedText: 'apple banana', tokenCount: 2 },
      { chunkIndex: 1, cleanedText: 'cherry', tokenCount: 1 },
    ]);
    manager.replaceKnowledgeMaterialChunks('m2', [
      { chunkIndex: 0, cleanedText: 'date', tokenCount: 1 },
    ]);
    manager.replaceKnowledgeMaterialChunks('m3', [
      { chunkIndex: 0, cleanedText: 'never returned', tokenCount: 1 },
    ]);
  });

  it('getKnowledgeMaterialChunks returns rows only for complete materials', () => {
    const rows = manager.getKnowledgeMaterialChunks();
    assert.equal(rows.length, 3);
    assert.ok(rows.every(r => r.id !== 'm3'));
  });

  it('getKnowledgeMaterialCandidateChunks filters by query terms', () => {
    const rows = manager.getKnowledgeMaterialCandidateChunks('apple', { candidateLimit: 50 });
    assert.ok(rows.length >= 1);
    assert.ok(rows.some(r => r.cleaned_text.includes('apple')));
  });

  it('getKnowledgeMaterialCandidateChunks returns all when no terms match', () => {
    const rows = manager.getKnowledgeMaterialCandidateChunks('zzz_no_match_xyz', { candidateLimit: 50 });
    // Falls back to "no WHERE on terms" path, still bounded by status = 'complete'.
    assert.equal(rows.length, 3);
  });

  it('getKnowledgeMaterialCandidateChunks respects candidateLimit', () => {
    const rows = manager.getKnowledgeMaterialCandidateChunks('zzz', { candidateLimit: 1 });
    assert.equal(rows.length, 1);
  });

  it('getKnowledgeMaterialCandidateChunks prioritizes title matches before candidateLimit', () => {
    manager.upsertKnowledgeMaterial({
      id: 'old_title',
      fileName: 'force-simulation-case.md',
      title: '力学仿真模块客户案例',
      mimeOrExt: 'md',
      fileHash: 'h_old_title',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('old_title', [
      { chunkIndex: 0, cleanedText: '这份资料介绍结构分析和仿真模块落地案例。', tokenCount: 20 },
    ]);
    manager.upsertKnowledgeMaterial({
      id: 'new_body',
      fileName: 'pricing.md',
      title: '最新价格资料',
      mimeOrExt: 'md',
      fileHash: 'h_new_body',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('new_body', [
      { chunkIndex: 0, cleanedText: '这是一段普通正文，偶然提到力学仿真模块，但重点是报价。', tokenCount: 20 },
    ]);

    const rows = manager.getKnowledgeMaterialCandidateChunks('力学仿真模块 案例', {
      candidateLimit: 1,
      candidateTerms: ['力学仿真模块', '案例'],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].material_id, 'old_title');
  });

  it('getKnowledgeMaterialCandidateChunks treats candidateTerms as recall OR signals', () => {
    manager.upsertKnowledgeMaterial({
      id: 'only_force',
      fileName: 'force.md',
      title: '力学仿真能力说明',
      mimeOrExt: 'md',
      fileHash: 'h_force',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('only_force', [
      { chunkIndex: 0, cleanedText: '力学仿真模块支持结构分析和产品适配验证。', tokenCount: 20 },
    ]);

    const rows = manager.getKnowledgeMaterialCandidateChunks('力学仿真模块 客户案例', {
      candidateLimit: 10,
      candidateTerms: ['力学仿真模块', '客户案例'],
    });

    assert.ok(rows.some((row) => row.material_id === 'only_force'));
  });

  it('getKnowledgeMaterialCandidateChunks prioritizes file-name matches before body matches', () => {
    manager.upsertKnowledgeMaterial({
      id: 'file_match',
      fileName: 'windchill-qms-readonly.md',
      title: '集成说明',
      mimeOrExt: 'md',
      fileHash: 'h_file',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('file_match', [
      { chunkIndex: 0, cleanedText: '这份资料介绍只读同步和权限验证。', tokenCount: 20 },
    ]);
    manager.upsertKnowledgeMaterial({
      id: 'body_match',
      fileName: 'generic.md',
      title: '通用资料',
      mimeOrExt: 'md',
      fileHash: 'h_body',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('body_match', [
      { chunkIndex: 0, cleanedText: '正文里提到 Windchill QMS，但主要是泛化流程介绍。', tokenCount: 20 },
    ]);

    const rows = manager.getKnowledgeMaterialCandidateChunks('Windchill QMS', {
      candidateLimit: 1,
      candidateTerms: ['Windchill', 'QMS'],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].material_id, 'file_match');
  });

  it('getKnowledgeMaterialCandidateChunks prioritizes parent text matches before child-only matches', () => {
    manager.upsertKnowledgeMaterial({
      id: 'parent_match',
      fileName: 'parent.md',
      title: '父块资料',
      mimeOrExt: 'md',
      fileHash: 'h_parent',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('parent_match', [
      {
        chunkIndex: 0,
        cleanedText: '这个子块只说验证步骤。',
        parentText: 'Windchill BOM 只读同步到 QMS CAPA 的权限边界验证步骤。',
        tokenCount: 20,
      },
    ]);
    manager.upsertKnowledgeMaterial({
      id: 'child_match',
      fileName: 'child.md',
      title: '子块资料',
      mimeOrExt: 'md',
      fileHash: 'h_child',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('child_match', [
      { chunkIndex: 0, cleanedText: 'Windchill BOM QMS CAPA 这些词出现在孤立子块里。', tokenCount: 20 },
    ]);

    const rows = manager.getKnowledgeMaterialCandidateChunks('Windchill BOM QMS CAPA', {
      candidateLimit: 1,
      candidateTerms: ['Windchill', 'BOM', 'QMS', 'CAPA'],
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].material_id, 'parent_match');
  });

  it('getKnowledgeMaterialCandidateChunks fills sparse structured results from broad fallback rows', () => {
    manager.upsertKnowledgeMaterial({
      id: 'structured_hit',
      fileName: 'force.md',
      title: '力学仿真模块',
      mimeOrExt: 'md',
      fileHash: 'h_structured',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('structured_hit', [
      { chunkIndex: 0, cleanedText: '力学仿真模块支持结构分析。', tokenCount: 20 },
    ]);
    manager.upsertKnowledgeMaterial({
      id: 'broad_fill',
      fileName: 'fallback.md',
      title: '补齐资料',
      mimeOrExt: 'md',
      fileHash: 'h_broad',
      status: 'complete',
    });
    manager.replaceKnowledgeMaterialChunks('broad_fill', [
      { chunkIndex: 0, cleanedText: '这份资料没有命中强词，但可用于 broad fallback 补齐候选池。', tokenCount: 20 },
    ]);

    const rows = manager.getKnowledgeMaterialCandidateChunks('力学仿真模块', {
      candidateLimit: 4,
      minStructuredRows: 3,
      candidateTerms: ['力学仿真模块'],
    });

    assert.ok(rows.some((row) => row.material_id === 'structured_hit'));
    assert.ok(rows.some((row) => row.material_id === 'broad_fill'));
  });
});

describe('DatabaseManager — deleteKnowledgeMaterial / getMaterialQueueStatus / markKnowledgeMaterialEmbeddingsFailed', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createKnowledgeSchema(db);
    manager.upsertKnowledgeMaterial({ id: 'md', fileName: 'd', mimeOrExt: 'pdf', fileHash: 'hd', status: 'indexing' });
  });

  it('deleteKnowledgeMaterial soft-deletes the material and removes its chunks', () => {
    manager.replaceKnowledgeMaterialChunks('md', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
    ]);
    manager.deleteKnowledgeMaterial('md');
    const row = manager.getKnowledgeMaterial('md');
    assert.equal(row, null);
    const chunkCount = db.prepare('SELECT COUNT(*) AS c FROM knowledge_material_chunks WHERE material_id = ?').get('md').c;
    assert.equal(chunkCount, 0);
  });

  it('getMaterialQueueStatus counts by status', () => {
    const [chunkId] = manager.replaceKnowledgeMaterialChunks('md', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
      { chunkIndex: 1, cleanedText: 'B', tokenCount: 1 },
    ]);
    manager.setKnowledgeMaterialChunkEmbedding(chunkId, [0.1, 0.2]);
    const status = manager.getMaterialQueueStatus();
    assert.equal(status.completed, 1);
    assert.equal(status.pending, 1);
    assert.equal(status.processing, 0);
    assert.equal(status.failed, 0);
  });

  it('markKnowledgeMaterialEmbeddingsFailed flips pending queue rows for the material to failed', () => {
    manager.replaceKnowledgeMaterialChunks('md', [
      { chunkIndex: 0, cleanedText: 'A', tokenCount: 1 },
    ]);
    manager.markKnowledgeMaterialEmbeddingsFailed('md', 'embedding_provider_unavailable');
    const status = manager.getMaterialQueueStatus();
    assert.equal(status.failed, 1);
    assert.equal(status.pending, 0);
  });
});
