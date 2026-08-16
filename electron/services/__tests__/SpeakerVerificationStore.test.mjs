import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const databaseModuleUrl = new URL('../../../dist-electron/electron/db/DatabaseManager.js', import.meta.url);
const { DatabaseManager } = await import(databaseModuleUrl.href);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function createDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-store-'));
  const dbPath = path.join(dir, 'test.db');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE speaker_profiles (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      embedding BLOB NOT NULL,
      embedding_dim INTEGER NOT NULL,
      extractor_model TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      threshold REAL NOT NULL,
      enrolled_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      device_fingerprint TEXT,
      sample_count INTEGER NOT NULL DEFAULT 0,
      quality_score REAL,
      quality_band TEXT,
      min_self_similarity REAL,
      mean_self_similarity REAL,
      similarity_stddev REAL,
      calibrated_threshold REAL
    );
    CREATE TABLE speaker_profile_stats (
      profile_id TEXT PRIMARY KEY,
      total_verifications INTEGER NOT NULL DEFAULT 0,
      positive_verifications INTEGER NOT NULL DEFAULT 0,
      last_verified_at INTEGER,
      last_quality_score REAL,
      last_quality_band TEXT,
      low_quality_skips INTEGER NOT NULL DEFAULT 0,
      low_confidence_rejections INTEGER NOT NULL DEFAULT 0,
      error_count INTEGER NOT NULL DEFAULT 0,
      timeout_count INTEGER NOT NULL DEFAULT 0,
      last_failure_at INTEGER,
      near_threshold_non_me_count INTEGER NOT NULL DEFAULT 0,
      avg_latency_ms REAL,
      latency_sample_count INTEGER NOT NULL DEFAULT 0,
      last_outcome TEXT,
      last_error TEXT,
      last_recorded_at INTEGER
    );
  `);
  return { db, dir };
}

test('DatabaseManager migration creates speaker profile tables at version 28', () => {
  const db = read('electron/db/DatabaseManager.ts');
  assert.match(db, /Version 27 -> 28: Local speaker verification profile tables/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS speaker_profiles/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS speaker_profile_stats/);
  assert.match(db, /user_version = 28/);
});

test('DatabaseManager migration adds enrollment quality and runtime health stats at version 32', () => {
  const db = read('electron/db/DatabaseManager.ts');
  assert.match(db, /Version 31 -> 32: Add speaker enrollment calibration and runtime health stats/);
  assert.match(db, /addColumnIfMissing\('speaker_profiles', 'quality_score', 'REAL'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profiles', 'quality_band', 'TEXT'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profiles', 'min_self_similarity', 'REAL'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profiles', 'mean_self_similarity', 'REAL'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profiles', 'similarity_stddev', 'REAL'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profiles', 'calibrated_threshold', 'REAL'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'last_quality_score', 'REAL'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'last_quality_band', 'TEXT'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'low_quality_skips', 'INTEGER NOT NULL DEFAULT 0'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'low_confidence_rejections', 'INTEGER NOT NULL DEFAULT 0'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'error_count', 'INTEGER NOT NULL DEFAULT 0'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'timeout_count', 'INTEGER NOT NULL DEFAULT 0'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'last_failure_at', 'INTEGER'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'near_threshold_non_me_count', 'INTEGER NOT NULL DEFAULT 0'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'avg_latency_ms', 'REAL'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'latency_sample_count', 'INTEGER NOT NULL DEFAULT 0'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'last_outcome', 'TEXT'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'last_error', 'TEXT'\)/);
  assert.match(db, /addColumnIfMissing\('speaker_profile_stats', 'last_recorded_at', 'INTEGER'\)/);
  assert.match(db, /user_version = 32/);
  const v32Block = db.match(/if\s*\(\s*version\s*<\s*32\s*\)[\s\S]*?user_version\s*=\s*32/);
  assert.ok(v32Block, 'v32 migration block must exist');
  assert.doesNotMatch(v32Block[0], /user_version\s*=\s*(?:33|34)/);
});

test('DatabaseManager backfills missing timeout stats for the branch v33 intermediate schema and advances to current schema', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-store-v33-'));
  const db = new Database(path.join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE transcripts (
        id INTEGER PRIMARY KEY AUTOINCREMENT
      );
      CREATE TABLE speaker_profile_stats (
        profile_id TEXT PRIMARY KEY,
        total_verifications INTEGER NOT NULL DEFAULT 0,
        positive_verifications INTEGER NOT NULL DEFAULT 0,
        last_verified_at INTEGER,
        last_quality_score REAL,
        last_quality_band TEXT,
        low_quality_skips INTEGER NOT NULL DEFAULT 0,
        low_confidence_rejections INTEGER NOT NULL DEFAULT 0,
        error_count INTEGER NOT NULL DEFAULT 0,
        last_failure_at INTEGER
      );
    `);
    db.pragma('user_version = 33');

    const manager = Object.create(DatabaseManager.prototype);
    manager.db = db;
    manager.runMigrations();

    const columns = db.prepare('PRAGMA table_info(speaker_profile_stats)').all().map(({ name }) => name);
    for (const column of [
      'low_quality_skips', 'low_confidence_rejections', 'error_count', 'timeout_count', 'last_failure_at',
      'near_threshold_non_me_count', 'avg_latency_ms', 'latency_sample_count', 'last_outcome', 'last_error', 'last_recorded_at',
    ]) {
      assert.ok(columns.includes(column), `speaker_profile_stats must include ${column}`);
    }
    assert.equal(db.pragma('user_version', { simple: true }), 34);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SettingsManager exposes local speaker verification mode', () => {
  const settings = read('electron/services/SettingsManager.ts');
  assert.match(settings, /speakerVerificationMode\?: 'off' \| 'local'/);
  assert.match(settings, /getSpeakerVerificationMode\(\): 'off' \| 'local'/);
  assert.match(settings, /setSpeakerVerificationMode\(mode: 'off' \| 'local'\): void/);
});

test('SpeakerProfileStore saves, loads, and hard-deletes only the ME profile', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const { db, dir } = createDb();
  try {
    const store = new SpeakerProfileStore({ getDb: () => db });
    const embedding = new Float32Array([0.5, 0.5, 0.5, 0.5]);

    store.saveMeProfile({
      embedding,
      embeddingDim: 4,
      extractorModel: 'test-model.onnx',
      extractorVersion: 'test-version',
      threshold: 0.72,
      deviceFingerprint: 'Built-in Microphone',
      sampleCount: 3,
      quality: {
        minSelfSimilarity: 0.93,
        meanSelfSimilarity: 0.96,
        similarityStddev: 0.02,
        calibratedThreshold: 0.86,
        qualityScore: 0.94,
        qualityBand: 'stable',
      },
      nowMs: 1700000000000,
    });

    const profile = store.getMeProfile();
    assert.equal(profile?.id, 'me');
    assert.equal(profile?.label, 'ME');
    assert.deepEqual(Array.from(profile.embedding), Array.from(embedding));
    assert.equal(profile.threshold, 0.72);
    assert.equal(profile.sampleCount, 3);
    assert.equal(profile.quality?.qualityBand, 'stable');
    assert.equal(profile.quality?.qualityScore, 0.94);
    assert.deepEqual(
      db.prepare(`
        SELECT quality_score, quality_band, min_self_similarity, mean_self_similarity,
               similarity_stddev, calibrated_threshold
        FROM speaker_profiles WHERE id = 'me'
      `).get(),
      {
        quality_score: 0.94,
        quality_band: 'stable',
        min_self_similarity: 0.93,
        mean_self_similarity: 0.96,
        similarity_stddev: 0.02,
        calibrated_threshold: 0.86,
      },
    );

    const status = store.getStatus('local', { state: 'ready' });
    assert.equal(status.quality?.qualityBand, 'stable');
    assert.equal(status.quality?.minSelfSimilarity, 0.93);
    assert.equal(status.quality?.meanSelfSimilarity, 0.96);
    assert.equal(status.quality?.calibratedThreshold, 0.86);

    db.prepare(`
      INSERT INTO speaker_profile_stats
        (profile_id, total_verifications, positive_verifications, last_verified_at)
      VALUES ('me', 10, 8, 1700000000100)
    `).run();

    store.deleteMeProfile();

    assert.equal(store.getMeProfile(), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM speaker_profiles WHERE id = 'me'").get().n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM speaker_profile_stats WHERE profile_id = 'me'").get().n, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SpeakerProfileStore reads legacy profiles without quality columns', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-store-legacy-'));
  const db = new Database(path.join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE speaker_profiles (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, embedding BLOB NOT NULL, embedding_dim INTEGER NOT NULL,
        extractor_model TEXT NOT NULL, extractor_version TEXT NOT NULL, threshold REAL NOT NULL,
        enrolled_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, device_fingerprint TEXT,
        sample_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    db.prepare(`
      INSERT INTO speaker_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run('me', 'ME', Buffer.from(new Float32Array([0.5, 0.5]).buffer), 2, 'test-model', 'v1', 0.72, 1, 1, null, 3);

    const profile = new SpeakerProfileStore({ getDb: () => db }).getMeProfile();
    assert.equal(profile?.id, 'me');
    assert.equal(profile?.quality, undefined);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SpeakerProfileStore falls back to the default threshold for invalid legacy values', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-store-invalid-threshold-'));
  const db = new Database(path.join(dir, 'test.db'));
  try {
    db.exec(`
      CREATE TABLE speaker_profiles (
        id TEXT PRIMARY KEY, label TEXT NOT NULL, embedding BLOB NOT NULL, embedding_dim INTEGER NOT NULL,
        extractor_model TEXT NOT NULL, extractor_version TEXT NOT NULL, threshold REAL,
        enrolled_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, device_fingerprint TEXT,
        sample_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    const store = new SpeakerProfileStore({ getDb: () => db });
    for (const threshold of [null, NaN, Infinity, -Infinity]) {
      db.prepare('DELETE FROM speaker_profiles').run();
      db.prepare('INSERT INTO speaker_profiles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run('me', 'ME', Buffer.from(new Float32Array([1, 0]).buffer), 2, 'test-model', 'v1', threshold, 1, 1, null, 3);

      assert.equal(store.getMeProfile()?.threshold, 0.72, `invalid threshold ${threshold} must use fallback`);
    }
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SpeakerProfileStore exposes health state and privacy-safe failure counters', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const { db, dir } = createDb();
  try {
    const store = new SpeakerProfileStore({ getDb: () => db });
    store.saveMeProfile({
      embedding: new Float32Array([0.5, 0.5]),
      embeddingDim: 2,
      extractorModel: 'test-model.onnx',
      extractorVersion: 'test-version',
      threshold: 0.72,
      sampleCount: 3,
    });

    assert.equal(store.getStatus('off', { state: 'ready' }).health.state, 'paused');
    assert.equal(store.getStatus('local', { state: 'model_missing' }).enabled, false);
    store.recordVerification('low_quality');
    store.recordVerification('verified', false);
    store.recordVerification('error');
    store.recordVerification('timeout');

    const status = store.getStatus('local', { state: 'ready' });
    assert.equal(status.health.state, 'degraded');
    assert.deepEqual(status.stats, {
      totalVerifications: 4,
      positiveVerifications: 0,
      lowQualitySkips: 1,
      lowConfidenceRejections: 1,
      nearThresholdNonMeCount: 0,
      errorCount: 1,
      timeoutCount: 1,
      latencySampleCount: 0,
      lastVerifiedAt: status.stats.lastVerifiedAt,
      lastFailureAt: status.stats.lastFailureAt,
      lastOutcome: 'timeout',
      lastRecordedAt: status.stats.lastRecordedAt,
    });
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SpeakerProfileStore records reliability outcomes and a cumulative latency average', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const { db, dir } = createDb();
  try {
    const store = new SpeakerProfileStore({ getDb: () => db });
    store.saveMeProfile({
      embedding: new Float32Array([0.5, 0.5]), embeddingDim: 2,
      extractorModel: 'test-model', extractorVersion: 'v1', threshold: 0.72, sampleCount: 3,
    });
    store.recordVerificationStat({ outcome: 'positive', latencyMs: 10, nowMs: 100 });
    store.recordVerificationStat({ outcome: 'low_confidence', latencyMs: 20, nowMs: 200 });
    store.recordVerificationStat({ outcome: 'near_threshold_non_me', latencyMs: 30, nowMs: 300 });
    store.recordVerificationStat({ outcome: 'low_quality', latencyMs: 40, nowMs: 400 });
    store.recordVerificationStat({ outcome: 'error', latencyMs: 50, error: 'speaker_verification_failed', nowMs: 500 });
    store.recordVerificationStat({ outcome: 'timeout', nowMs: 600 });

    assert.deepEqual(store.getStats(), {
      totalVerifications: 6,
      positiveVerifications: 1,
      lowQualitySkips: 1,
      lowConfidenceRejections: 1,
      nearThresholdNonMeCount: 1,
      errorCount: 1,
      timeoutCount: 1,
      avgLatencyMs: 30,
      latencySampleCount: 5,
      lastVerifiedAt: 300,
      lastFailureAt: 600,
      lastOutcome: 'timeout',
      lastError: 'speaker_verification_failed',
      lastRecordedAt: 600,
    });
    assert.deepEqual(store.getStatus('off').stats, store.getStats());
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('normal low-confidence rejection does not degrade speaker verification health', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const { db, dir } = createDb();
  try {
    const store = new SpeakerProfileStore({ getDb: () => db });
    store.saveMeProfile({
      embedding: new Float32Array([0.5, 0.5]), embeddingDim: 2,
      extractorModel: 'test-model', extractorVersion: 'v1', threshold: 0.72, sampleCount: 3,
    });
    store.recordVerificationStat({ outcome: 'low_confidence', nowMs: Date.now() });

    const status = store.getStatus('local', { state: 'ready' });
    assert.equal(status.health.state, 'ready');
    assert.equal(status.stats.lastFailureAt, undefined);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('late verification cannot recreate stats after its profile is deleted', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const { db, dir } = createDb();
  try {
    const store = new SpeakerProfileStore({ getDb: () => db });
    store.saveMeProfile({
      embedding: new Float32Array([1, 0]), embeddingDim: 2,
      extractorModel: 'test-model', extractorVersion: 'v1', threshold: 0.72, sampleCount: 3,
    });
    let resolveEmbedding;
    const service = new SpeakerVerificationService({
      store,
      extractor: {
        dim: 2, modelId: 'test-model', version: 'v1',
        extract: () => new Promise(resolve => { resolveEmbedding = resolve; }),
      },
    });

    const verification = service.verify(new Float32Array(16000 * 2).fill(0.2));
    store.deleteMeProfile();
    resolveEmbedding(new Float32Array([1, 0]));
    await verification;

    assert.equal(store.getMeProfile(), null);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM speaker_profile_stats WHERE profile_id = 'me'").get().n, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SpeakerProfileStore maps unknown error codes to a fixed safe code', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const { db, dir } = createDb();
  try {
    const store = new SpeakerProfileStore({ getDb: () => db });
    store.saveMeProfile({
      embedding: new Float32Array([0.5, 0.5]), embeddingDim: 2,
      extractorModel: 'test-model', extractorVersion: 'v1', threshold: 0.72, sampleCount: 3,
    });
    store.recordVerificationStat({ outcome: 'error', error: 'unknown_speaker_error', nowMs: 100 });

    assert.equal(store.getStats().lastError, 'speaker_verification_failed');
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('SpeakerVerificationAnnotator records low-quality skips through the verification service', async () => {
  const { SpeakerProfileStore } = await import('../../../dist-electron/electron/services/speaker/SpeakerProfileStore.js');
  const { SpeakerVerificationService } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationService.js');
  const { SpeakerVerificationAnnotator } = await import('../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js');
  const { db, dir } = createDb();
  try {
    const store = new SpeakerProfileStore({ getDb: () => db });
    store.saveMeProfile({
      embedding: new Float32Array([0.5, 0.5]),
      embeddingDim: 2,
      extractorModel: 'test-model.onnx',
      extractorVersion: 'test-version',
      threshold: 0.72,
      sampleCount: 3,
    });
    const service = new SpeakerVerificationService({
      store,
      extractor: {
        dim: 2,
        modelId: 'test-model.onnx',
        version: 'test-version',
        extract: async () => { throw new Error('extract_should_not_run_for_low_quality_audio'); },
      },
    });
    const annotator = new SpeakerVerificationAnnotator({ getMode: () => 'local', service });

    assert.equal(await annotator.annotate(new Float32Array()), undefined);
    assert.equal(store.getStatus('local', { state: 'ready' }).stats.lowQualitySkips, 1);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('extractor worker failure is surfaced as a model error without crashing the main process', async () => {
  const { getSpeakerEmbeddingModelHealth } = await import('../../../dist-electron/electron/services/speaker/SpeakerEmbeddingExtractor.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-speaker-extractor-'));
  const modelFile = path.join(dir, 'model.onnx');
  const workerFile = path.join(dir, 'speaker-worker-fail.cjs');
  const originalModelFile = process.env.SPEAKER_EMBEDDING_MODEL_FILE;
  const originalWorkerFile = process.env.SPEAKER_EMBEDDING_WORKER_FILE;
  fs.writeFileSync(modelFile, 'model path only; extractor module load is intentionally unavailable');
  fs.writeFileSync(workerFile, `
    process.on('message', (message) => {
      process.send({ requestId: message.requestId, error: 'speaker_embedding_worker_failed' });
    });
  `);
  process.env.SPEAKER_EMBEDDING_MODEL_FILE = modelFile;
  process.env.SPEAKER_EMBEDDING_WORKER_FILE = workerFile;
  try {
    assert.equal(getSpeakerEmbeddingModelHealth().state, 'ready');
    assert.equal((await getSpeakerEmbeddingModelHealth({ smokeTest: true })).state, 'model_error');
    assert.equal(getSpeakerEmbeddingModelHealth().state, 'model_error');
  } finally {
    if (originalModelFile === undefined) delete process.env.SPEAKER_EMBEDDING_MODEL_FILE;
    else process.env.SPEAKER_EMBEDDING_MODEL_FILE = originalModelFile;
    if (originalWorkerFile === undefined) delete process.env.SPEAKER_EMBEDDING_WORKER_FILE;
    else process.env.SPEAKER_EMBEDDING_WORKER_FILE = originalWorkerFile;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
