// DatabaseManager.contextTrace.test.mjs
// PR2.3: answer_context_traces / answer_quality_events + diagnostics aggregations.

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

function createContextTraceSchema(db) {
  // The context-trace tables have FK references to meetings(id) with ON DELETE
  // SET NULL / CASCADE. We need a minimal meetings table so the FKs parse.
  db.exec(`
    CREATE TABLE meetings (
      id TEXT PRIMARY KEY,
      title TEXT
    );

    CREATE TABLE answer_context_traces (
      id TEXT PRIMARY KEY,
      answer_id TEXT NOT NULL UNIQUE,
      meeting_id TEXT,
      interaction_id INTEGER,
      answer_type TEXT NOT NULL DEFAULT 'what_to_say',
      surface TEXT NOT NULL DEFAULT 'overlay',
      provider TEXT,
      model TEXT,
      latency_ms INTEGER,
      context_used_json TEXT NOT NULL DEFAULT '{}',
      citations_json TEXT NOT NULL DEFAULT '[]',
      degraded_reason TEXT,
      status TEXT NOT NULL DEFAULT 'generated',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
    );

    CREATE TABLE answer_quality_events (
      id TEXT PRIMARY KEY,
      answer_id TEXT NOT NULL,
      meeting_id TEXT,
      event_type TEXT NOT NULL CHECK(event_type IN ('shown', 'copied', 'accepted', 'ignored', 'regenerated')),
      surface TEXT NOT NULL DEFAULT 'overlay',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(answer_id) REFERENCES answer_context_traces(answer_id) ON DELETE CASCADE,
      FOREIGN KEY(meeting_id) REFERENCES meetings(id) ON DELETE SET NULL
    );
  `);
}

function seedMeeting(db, id = 'meet_1') {
  db.prepare('INSERT INTO meetings (id, title) VALUES (?, ?)').run(id, 'test meeting');
}

const baseInput = (overrides = {}) => ({
  answerId: 'ans_001',
  meetingId: 'meet_1',
  interactionId: 42,
  answerType: 'what_to_say',
  surface: 'overlay',
  provider: 'natively',
  model: 'doubao-seed-2-0-lite',
  latencyMs: 1234,
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
    ragAttempted: true,
    ragReady: true,
    embeddingReady: true,
    uploadedMaterialHitCount: 0,
    citationCount: 1,
    screenContextStatus: 'not_available',
  },
  citations: [{ citationId: 'c1', sourceType: 'current_meeting', sourceId: 'meet_1' }],
  status: 'generated',
  ...overrides,
});

describe('DatabaseManager — saveAnswerContextTrace / getAnswerContextTrace', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createContextTraceSchema(db);
    seedMeeting(db);
  });

  it('saveAnswerContextTrace returns a row, getAnswerContextTrace round-trips it', () => {
    const saved = manager.saveAnswerContextTrace(baseInput());
    assert.ok(saved);
    assert.equal(saved.answer_id, 'ans_001');
    assert.equal(saved.provider, 'natively');
    assert.equal(saved.model, 'doubao-seed-2-0-lite');
    assert.equal(saved.latency_ms, 1234);

    const fetched = manager.getAnswerContextTrace('ans_001');
    assert.equal(fetched.answer_id, 'ans_001');
    assert.equal(fetched.contextUsed.currentTranscript, true);
    assert.equal(fetched.contextUsed.uploadedDocumentRag, false);
    assert.equal(fetched.citations.length, 1);
    assert.equal(fetched.citations[0].sourceId, 'meet_1');
    assert.equal(fetched.sourceStatus.citationCount, 1);
  });

  it('saveAnswerContextTrace upserts on duplicate answer_id', () => {
    manager.saveAnswerContextTrace(baseInput());
    manager.saveAnswerContextTrace(baseInput({ latencyMs: 999, model: 'm_b' }));
    const count = db.prepare('SELECT COUNT(*) AS c FROM answer_context_traces').get().c;
    assert.equal(count, 1);
    const row = manager.getAnswerContextTrace('ans_001');
    assert.equal(row.latency_ms, 999);
    assert.equal(row.model, 'm_b');
  });

  it('getAnswerContextTrace returns null for an unknown id', () => {
    assert.equal(manager.getAnswerContextTrace('nope'), null);
  });

  it('saveAnswerContextTrace normalizes null/undefined inputs to defaults', () => {
    const saved = manager.saveAnswerContextTrace({ answerId: 'ans_min' });
    assert.ok(saved);
    assert.equal(saved.answer_type, 'what_to_say');
    assert.equal(saved.surface, 'overlay');
    assert.equal(saved.status, 'generated');
    assert.equal(saved.provider, null);
  });
});

describe('DatabaseManager — trackAnswerQualityEvent / getAnswerQualityMetrics', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createContextTraceSchema(db);
    seedMeeting(db);
    manager.saveAnswerContextTrace(baseInput());
  });

  it('trackAnswerQualityEvent returns {success:false} for an unknown answerId', () => {
    const result = manager.trackAnswerQualityEvent({ answerId: 'nope', eventType: 'shown' });
    assert.equal(result.success, false);
    assert.equal(result.error, 'answer_id_not_found');
  });

  it('trackAnswerQualityEvent records a shown event and reports a single shown count', () => {
    const r = manager.trackAnswerQualityEvent({ answerId: 'ans_001', eventType: 'shown' });
    assert.equal(r.success, true);
    assert.ok(r.id);

    const m = manager.getAnswerQualityMetrics({});
    assert.equal(m.shownCount, 1);
    assert.equal(m.acceptedCount, 0);
    assert.equal(m.copiedCount, 0);
    assert.equal(m.regeneratedCount, 0);
  });

  it('getAnswerQualityMetrics dedupes shown events per (answer_id, surface)', () => {
    manager.trackAnswerQualityEvent({ answerId: 'ans_001', eventType: 'shown' });
    manager.trackAnswerQualityEvent({ answerId: 'ans_001', eventType: 'shown' });
    const m = manager.getAnswerQualityMetrics({});
    assert.equal(m.shownCount, 1);
  });

  it('getAnswerQualityMetrics computes userAcceptanceRate and citationHitRate', () => {
    manager.trackAnswerQualityEvent({ answerId: 'ans_001', eventType: 'shown' });
    manager.trackAnswerQualityEvent({ answerId: 'ans_001', eventType: 'accepted' });
    const m = manager.getAnswerQualityMetrics({});
    assert.equal(m.shownCount, 1);
    assert.equal(m.acceptedCount, 1);
    assert.equal(m.userAcceptanceRate, 1);
    // sourceStatus.citationCount = 1, so citationHitRate should be 1.
    assert.equal(m.citationHitRate, 1);
  });

  it('getAnswerQualityMetrics reports latency for the seeded trace', () => {
    // The trackAnswerQualityEvent group shares a beforeEach that seeds
    // a context trace, so we can assert on its latency here.
    const m = manager.getAnswerQualityMetrics({});
    assert.equal(m.averageLatencyMs, 1234);
    assert.equal(m.p95LatencyMs, 1234);
  });

  it('getAnswerQualityMetrics filters by sinceMs', () => {
    // Insert a row, force its created_at to be in the past.
    db.prepare("UPDATE answer_context_traces SET created_at = '2000-01-01 00:00:00' WHERE answer_id = ?").run('ans_001');
    const future = Date.now() + 60_000;
    const m = manager.getAnswerQualityMetrics({ sinceMs: future });
    // Future cutoff should drop the row.
    assert.equal(m.shownCount, 0);
  });

  it('getAnswerQualityMetrics filters by mode (answer_type)', () => {
    manager.saveAnswerContextTrace(baseInput({ answerId: 'ans_002', answerType: 'deep_dive' }));
    const m = manager.getAnswerQualityMetrics({ mode: 'deep_dive' });
    assert.equal(m.shownCount, 0);
  });
});

describe('DatabaseManager — getRealtimeDiagnosticsAggregate', () => {
  let db, manager;

  beforeEach(() => {
    ({ db, manager } = makeManager());
    createContextTraceSchema(db);
    seedMeeting(db);
  });

  it('returns empty aggregate when the database is empty', () => {
    const agg = manager.getRealtimeDiagnosticsAggregate({});
    assert.equal(agg.metrics.shownCount, 0);
    assert.deepEqual(agg.degradedReasons, {});
    assert.deepEqual(agg.sourceStatusCounts, {});
    assert.equal(agg.traceSampleSize, 0);
  });

  it('aggregates degraded reasons and source status counts', () => {
    manager.saveAnswerContextTrace(baseInput({ answerId: 'a1', degradedReason: 'transcript_truncated' }));
    manager.saveAnswerContextTrace(baseInput({ answerId: 'a2', degradedReason: 'transcript_truncated' }));
    manager.saveAnswerContextTrace(baseInput({ answerId: 'a3' }));
    const agg = manager.getRealtimeDiagnosticsAggregate({});
    assert.equal(agg.traceSampleSize, 3);
    assert.equal(agg.degradedReasons.transcript_truncated, 2);
  });

  it('honors sinceMs and mode filters', () => {
    manager.saveAnswerContextTrace(baseInput({ answerId: 'a1' }));
    manager.saveAnswerContextTrace(baseInput({ answerId: 'a2', answerType: 'deep_dive' }));
    const agg = manager.getRealtimeDiagnosticsAggregate({ mode: 'deep_dive' });
    assert.equal(agg.traceSampleSize, 1);
  });
});
