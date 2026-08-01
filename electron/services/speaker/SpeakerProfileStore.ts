import type Database from 'better-sqlite3';
import {
  SPEAKER_PROFILE_ME_ID,
  SPEAKER_PROFILE_ME_LABEL,
  type SaveSpeakerProfileInput,
  type SpeakerEnrollmentQualitySummary,
  type SpeakerProfileRecord,
  type SpeakerVerificationMode,
  type SpeakerVerificationStatus,
} from './speakerVerificationTypes';

interface DbProvider {
  getDb(): Database.Database | null;
}

function embeddingToBlob(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

function blobToEmbedding(blob: Buffer, dim: number): Float32Array {
  const copy = Buffer.from(blob);
  return new Float32Array(copy.buffer, copy.byteOffset, dim).slice();
}

function parseQuality(value: unknown): SpeakerEnrollmentQualitySummary | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    const quality = JSON.parse(value) as Partial<SpeakerEnrollmentQualitySummary>;
    if (
      typeof quality.minSelfSimilarity !== 'number'
      || typeof quality.meanSelfSimilarity !== 'number'
      || typeof quality.similarityStddev !== 'number'
      || typeof quality.calibratedThreshold !== 'number'
      || typeof quality.qualityScore !== 'number'
      || !['stable', 'weak_boundary', 'needs_rerecord'].includes(quality.qualityBand ?? '')
    ) return undefined;
    return quality as SpeakerEnrollmentQualitySummary;
  } catch {
    return undefined;
  }
}

export class SpeakerProfileStore {
  constructor(private readonly dbProvider: DbProvider) {}

  getStatus(mode: SpeakerVerificationMode = 'off'): SpeakerVerificationStatus {
    const profile = this.getMeProfile();
    if (!profile) return { enrolled: false, mode };
    return {
      enrolled: true,
      enrolledAt: profile.enrolledAt,
      model: profile.extractorModel,
      mode,
    };
  }

  getMeProfile(): SpeakerProfileRecord | null {
    const db = this.dbProvider.getDb();
    if (!db) return null;
    const selectProfile = `
      SELECT id, label, embedding, embedding_dim, extractor_model, extractor_version,
             threshold, enrolled_at, updated_at, device_fingerprint, sample_count, enrollment_quality_json
      FROM speaker_profiles
      WHERE id = ?
    `;
    const selectLegacyProfile = `
      SELECT id, label, embedding, embedding_dim, extractor_model, extractor_version,
             threshold, enrolled_at, updated_at, device_fingerprint, sample_count
      FROM speaker_profiles
      WHERE id = ?
    `;
    let row: any;
    try {
      row = db.prepare(selectProfile).get(SPEAKER_PROFILE_ME_ID);
    } catch {
      row = db.prepare(selectLegacyProfile).get(SPEAKER_PROFILE_ME_ID);
    }
    if (!row) return null;
    return {
      id: SPEAKER_PROFILE_ME_ID,
      label: SPEAKER_PROFILE_ME_LABEL,
      embedding: blobToEmbedding(row.embedding, row.embedding_dim),
      embeddingDim: row.embedding_dim,
      extractorModel: row.extractor_model,
      extractorVersion: row.extractor_version,
      threshold: row.threshold,
      enrolledAt: row.enrolled_at,
      updatedAt: row.updated_at,
      deviceFingerprint: row.device_fingerprint || undefined,
      sampleCount: row.sample_count,
      quality: parseQuality(row.enrollment_quality_json),
    };
  }

  saveMeProfile(input: SaveSpeakerProfileInput): void {
    const db = this.dbProvider.getDb();
    if (!db) throw new Error('speaker_profile_store_unavailable');
    const nowMs = input.nowMs ?? Date.now();
    db.prepare(`
      INSERT INTO speaker_profiles (
        id, label, embedding, embedding_dim, extractor_model, extractor_version,
        threshold, enrolled_at, updated_at, device_fingerprint, sample_count, enrollment_quality_json
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label = excluded.label,
        embedding = excluded.embedding,
        embedding_dim = excluded.embedding_dim,
        extractor_model = excluded.extractor_model,
        extractor_version = excluded.extractor_version,
        threshold = excluded.threshold,
        updated_at = excluded.updated_at,
        device_fingerprint = excluded.device_fingerprint,
        sample_count = excluded.sample_count,
        enrollment_quality_json = excluded.enrollment_quality_json
    `).run(
      SPEAKER_PROFILE_ME_ID,
      SPEAKER_PROFILE_ME_LABEL,
      embeddingToBlob(input.embedding),
      input.embeddingDim,
      input.extractorModel,
      input.extractorVersion,
      input.threshold,
      nowMs,
      nowMs,
      input.deviceFingerprint ?? null,
      input.sampleCount,
      input.quality ? JSON.stringify(input.quality) : null,
    );
  }

  deleteMeProfile(): void {
    const db = this.dbProvider.getDb();
    if (!db) return;
    const tx = db.transaction(() => {
      db.prepare('DELETE FROM speaker_profile_stats WHERE profile_id = ?').run(SPEAKER_PROFILE_ME_ID);
      db.prepare('DELETE FROM speaker_profiles WHERE id = ?').run(SPEAKER_PROFILE_ME_ID);
    });
    tx();
  }
}
