import type Database from 'better-sqlite3';
import {
  SPEAKER_PROFILE_ME_ID,
  SPEAKER_PROFILE_ME_LABEL,
  type SaveSpeakerProfileInput,
  type SpeakerEnrollmentQualitySummary,
  type SpeakerProfileRecord,
  type SpeakerVerificationHealth,
  type SpeakerVerificationMode,
  type SpeakerVerificationStatus,
  type SpeakerVerificationStats,
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

function qualityFromRow(row: Record<string, unknown>): SpeakerEnrollmentQualitySummary | undefined {
  const quality = {
    minSelfSimilarity: row.min_self_similarity,
    meanSelfSimilarity: row.mean_self_similarity,
    similarityStddev: row.similarity_stddev,
    calibratedThreshold: row.calibrated_threshold,
    qualityScore: row.quality_score,
    qualityBand: row.quality_band,
  };
  if (
    !Object.values(quality).slice(0, 5).every((value) => typeof value === 'number' && Number.isFinite(value))
    || !['stable', 'weak_boundary', 'needs_rerecord'].includes(quality.qualityBand as string)
  ) return undefined;
  return quality as SpeakerEnrollmentQualitySummary;
}

export class SpeakerProfileStore {
  constructor(private readonly dbProvider: DbProvider) {}

  getStatus(mode: SpeakerVerificationMode = 'off', health?: SpeakerVerificationHealth): SpeakerVerificationStatus {
    const profile = this.getMeProfile();
    const stats = this.getVerificationStats();
    if (!profile) return {
      enrolled: false,
      enabled: false,
      mode,
      health: { state: 'not_enrolled' },
      stats,
    };
    const resolvedHealth = health ?? { state: 'ready' as const };
    const recentFailure = stats.lastFailureAt !== undefined && Date.now() - stats.lastFailureAt < 24 * 60 * 60 * 1000;
    const isDegraded = (profile.quality?.qualityBand !== undefined
      && profile.quality.qualityBand !== 'stable') || recentFailure;
    const state = mode === 'off'
      ? 'paused'
      : resolvedHealth.state === 'ready' && isDegraded
        ? 'degraded'
        : resolvedHealth.state;
    return {
      enrolled: true,
      enabled: state === 'ready' || state === 'degraded',
      enrolledAt: profile.enrolledAt,
      model: profile.extractorModel,
      mode,
      health: state === resolvedHealth.state ? resolvedHealth : { state },
      stats,
    };
  }

  getVerificationStats(): SpeakerVerificationStats {
    const db = this.dbProvider.getDb();
    const empty: SpeakerVerificationStats = {
      totalVerifications: 0,
      positiveVerifications: 0,
      lowQualitySkips: 0,
      lowConfidenceRejections: 0,
      errorCount: 0,
      timeoutCount: 0,
    };
    if (!db) return empty;
    try {
      const row = db.prepare(`
        SELECT total_verifications, positive_verifications, low_quality_skips,
               low_confidence_rejections, error_count, timeout_count, last_verified_at, last_failure_at
        FROM speaker_profile_stats WHERE profile_id = ?
      `).get(SPEAKER_PROFILE_ME_ID) as Record<string, unknown> | undefined;
      if (!row) return empty;
      return {
        totalVerifications: Number(row.total_verifications) || 0,
        positiveVerifications: Number(row.positive_verifications) || 0,
        lowQualitySkips: Number(row.low_quality_skips) || 0,
        lowConfidenceRejections: Number(row.low_confidence_rejections) || 0,
        errorCount: Number(row.error_count) || 0,
        timeoutCount: Number(row.timeout_count) || 0,
        lastVerifiedAt: typeof row.last_verified_at === 'number' ? row.last_verified_at : undefined,
        lastFailureAt: typeof row.last_failure_at === 'number' ? row.last_failure_at : undefined,
      };
    } catch {
      return empty;
    }
  }

  recordVerification(result: 'verified' | 'low_quality' | 'error' | 'timeout', isMe?: boolean): void {
    const db = this.dbProvider.getDb();
    if (!db) return;
    const now = Date.now();
    try {
      const total = result === 'verified' ? 1 : 0;
      const positive = result === 'verified' && isMe ? 1 : 0;
      const lowQuality = result === 'low_quality' ? 1 : 0;
      const rejected = result === 'verified' && !isMe ? 1 : 0;
      const errors = result === 'error' ? 1 : 0;
      const timeouts = result === 'timeout' ? 1 : 0;
      const failureAt = result === 'verified' && isMe ? null : now;
      db.prepare(`
        INSERT INTO speaker_profile_stats (
          profile_id, total_verifications, positive_verifications, low_quality_skips,
          low_confidence_rejections, error_count, timeout_count, last_verified_at, last_failure_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          total_verifications = total_verifications + excluded.total_verifications,
          positive_verifications = positive_verifications + excluded.positive_verifications,
          low_quality_skips = low_quality_skips + excluded.low_quality_skips,
          low_confidence_rejections = low_confidence_rejections + excluded.low_confidence_rejections,
          error_count = error_count + excluded.error_count,
          timeout_count = timeout_count + excluded.timeout_count,
          last_verified_at = COALESCE(excluded.last_verified_at, last_verified_at),
          last_failure_at = COALESCE(excluded.last_failure_at, last_failure_at)
      `).run(SPEAKER_PROFILE_ME_ID, total, positive, lowQuality, rejected, errors, timeouts, result === 'verified' ? now : null, failureAt);
    } catch {
      // Runtime telemetry must never interrupt transcription.
    }
  }

  getMeProfile(): SpeakerProfileRecord | null {
    const db = this.dbProvider.getDb();
    if (!db) return null;
    const selectProfile = `
      SELECT id, label, embedding, embedding_dim, extractor_model, extractor_version,
             threshold, enrolled_at, updated_at, device_fingerprint, sample_count,
             quality_score, quality_band, min_self_similarity, mean_self_similarity,
             similarity_stddev, calibrated_threshold
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
      quality: qualityFromRow(row),
    };
  }

  saveMeProfile(input: SaveSpeakerProfileInput): void {
    const db = this.dbProvider.getDb();
    if (!db) throw new Error('speaker_profile_store_unavailable');
    const nowMs = input.nowMs ?? Date.now();
    db.prepare(`
      INSERT INTO speaker_profiles (
        id, label, embedding, embedding_dim, extractor_model, extractor_version,
        threshold, enrolled_at, updated_at, device_fingerprint, sample_count,
        quality_score, quality_band, min_self_similarity, mean_self_similarity,
        similarity_stddev, calibrated_threshold
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        quality_score = excluded.quality_score,
        quality_band = excluded.quality_band,
        min_self_similarity = excluded.min_self_similarity,
        mean_self_similarity = excluded.mean_self_similarity,
        similarity_stddev = excluded.similarity_stddev,
        calibrated_threshold = excluded.calibrated_threshold
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
      input.quality?.qualityScore ?? null,
      input.quality?.qualityBand ?? null,
      input.quality?.minSelfSimilarity ?? null,
      input.quality?.meanSelfSimilarity ?? null,
      input.quality?.similarityStddev ?? null,
      input.quality?.calibratedThreshold ?? null,
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
