// AnswerContextTrace.crud.test.mjs
// TDD cycle 1: round-trip + upsert behavior of saveAnswerContextTrace / getAnswerContextTrace.

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import Database from 'better-sqlite3';
import { DatabaseManager } from '../../../dist-electron/electron/db/DatabaseManager.js';

describe('AnswerContextTrace persistence (crud)', () => {
  let db;
  let manager;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE answer_context_traces (
        id TEXT PRIMARY KEY,
        answer_id TEXT NOT NULL UNIQUE,
        meeting_id TEXT,
        interaction_id TEXT,
        answer_type TEXT NOT NULL DEFAULT 'what_to_say',
        surface TEXT NOT NULL DEFAULT 'overlay',
        provider TEXT,
        model TEXT,
        latency_ms REAL,
        context_used_json TEXT NOT NULL,
        citations_json TEXT NOT NULL DEFAULT '[]',
        degraded_reason TEXT,
        status TEXT NOT NULL DEFAULT 'generated'
      );
    `);
    manager = Object.create(DatabaseManager.prototype);
    manager.db = db;
  });

  it('saveAnswerContextTrace then getAnswerContextTrace round-trips core fields', () => {
    const input = {
      answerId: 'ans_roundtrip_001',
      meetingId: 'meet_1',
      interactionId: 'int_1',
      answerType: 'what_to_say',
      surface: 'overlay',
      provider: 'natively',
      model: 'doubao-seed-2-0-lite',
      latencyMs: 1234,
      contextUsed: {
        currentTranscript: true,
        shortTermHistory: true,
        uploadedDocumentRag: false,
        historicalMeetings: false,
        longTermMemory: false,
        enterpriseKnowledge: false,
        businessSystemContext: false,
        screenContext: false,
      },
      sourceStatus: {
        ragAttempted: true,
        ragReady: true,
        embeddingReady: true,
        uploadedMaterialHitCount: 0,
        citationCount: 0,
        screenContextStatus: 'not_available',
      },
      citations: [{ citationId: 'c1', sourceType: 'current_meeting', sourceId: 'meet_1' }],
      degradedReason: null,
      status: 'generated',
    };

    const saved = manager.saveAnswerContextTrace(input);
    assert.ok(saved, 'saveAnswerContextTrace must return the saved row');
    assert.equal(saved.answer_id, 'ans_roundtrip_001');
    assert.equal(saved.provider, 'natively');
    assert.equal(saved.model, 'doubao-seed-2-0-lite');
    assert.equal(saved.latency_ms, 1234);

    const fetched = manager.getAnswerContextTrace('ans_roundtrip_001');
    assert.ok(fetched, 'getAnswerContextTrace must return row after save');
    assert.equal(fetched.answer_id, 'ans_roundtrip_001');
    assert.equal(fetched.citations.length, 1);
    assert.equal(fetched.citations[0].sourceId, 'meet_1');
    assert.equal(fetched.contextUsed.currentTranscript, true);
    assert.equal(fetched.contextUsed.uploadedDocumentRag, false);
  });

  it('saveAnswerContextTrace on existing answer_id upserts (does not duplicate)', () => {
    const baseInput = {
      answerId: 'ans_upsert_001',
      meetingId: 'meet_1',
      provider: 'natively',
      model: 'model_a',
      latencyMs: 100,
      contextUsed: {
        currentTranscript: true,
        shortTermHistory: false,
        uploadedDocumentRag: false,
        historicalMeetings: false,
        longTermMemory: false,
        enterpriseKnowledge: false,
        businessSystemContext: false,
        screenContext: false,
      },
      sourceStatus: {
        ragAttempted: false,
        ragReady: false,
        embeddingReady: false,
        uploadedMaterialHitCount: 0,
        citationCount: 0,
        screenContextStatus: 'not_available',
      },
    };
    manager.saveAnswerContextTrace(baseInput);
    const countAfterFirst = db.prepare('SELECT COUNT(*) AS c FROM answer_context_traces').get().c;
    assert.equal(countAfterFirst, 1, 'first save must insert exactly one row');

    manager.saveAnswerContextTrace({ ...baseInput, latencyMs: 200, model: 'model_b' });
    const countAfterSecond = db.prepare('SELECT COUNT(*) AS c FROM answer_context_traces').get().c;
    assert.equal(countAfterSecond, 1, 'second save on same answer_id must upsert, not duplicate');

    const row = manager.getAnswerContextTrace('ans_upsert_001');
    assert.equal(row.latency_ms, 200, 'upsert must update latency_ms');
    assert.equal(row.model, 'model_b', 'upsert must update model');
  });
});
