import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');

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
      enrollment_quality_json TEXT
    );
    CREATE TABLE speaker_profile_stats (
      profile_id TEXT PRIMARY KEY,
      total_verifications INTEGER NOT NULL DEFAULT 0,
      positive_verifications INTEGER NOT NULL DEFAULT 0,
      last_verified_at INTEGER,
      last_quality_score REAL,
      last_quality_band TEXT
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

test('DatabaseManager migration adds enrollment quality and aggregate stats columns at version 32', () => {
  const db = read('electron/db/DatabaseManager.ts');
  assert.match(db, /Version 31 -> 32: Add speaker enrollment quality calibration/);
  assert.match(db, /ALTER TABLE speaker_profiles ADD COLUMN enrollment_quality_json TEXT/);
  assert.match(db, /ALTER TABLE speaker_profile_stats ADD COLUMN last_quality_score REAL/);
  assert.match(db, /ALTER TABLE speaker_profile_stats ADD COLUMN last_quality_band TEXT/);
  assert.match(db, /user_version = 32/);
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
