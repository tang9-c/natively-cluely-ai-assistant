import type Database from 'better-sqlite3';
import {
  SPEAKER_PROFILE_ME_ID,
  SPEAKER_PROFILE_ME_LABEL,
  type SaveSpeakerProfileInput,
  type SpeakerEnrollmentQualitySummary,
  type SpeakerProfileRecord,
  type SpeakerVerificationHealth,
  type SpeakerVerificationMode,
  type SpeakerVerificationOutcome,
  type SpeakerVerificationRuntimeStats,
  type SpeakerVerificationStatus,
  type SpeakerVerificationStats,
} from './speakerVerificationTypes';

interface DbProvider {
  getDb(): Database.Database | null;
}

const DEFAULT_SPEAKER_THRESHOLD = 0.72;

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

function toFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function resolveProfileThreshold(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
    ? value
    : DEFAULT_SPEAKER_THRESHOLD;
}

const SPEAKER_VERIFICATION_ERROR_CODES = new Set([
  'speaker_verification_failed',
  'speaker_verification_error',
]);

function safeErrorCode(error?: string): string | undefined {
  if (!error) return undefined;
  return SPEAKER_VERIFICATION_ERROR_CODES.has(error)
    ? error
    : 'speaker_verification_failed';
}

export class SpeakerProfileStore {
  constructor(private readonly dbProvider: DbProvider) {}

  getStatus(mode: SpeakerVerificationMode = 'off', health?: SpeakerVerificationHealth): SpeakerVerificationStatus {
    const profile = this.getMeProfile();
    const stats = this.getStats();
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

  getStats(): SpeakerVerificationRuntimeStats {
    const db = this.dbProvider.getDb();
    const empty: SpeakerVerificationRuntimeStats = {
      totalVerifications: 0,
      positiveVerifications: 0,
      lowQualitySkips: 0,
      lowConfidenceRejections: 0,
      nearThresholdNonMeCount: 0,
      errorCount: 0,
      timeoutCount: 0,
      latencySampleCount: 0,
    };
    if (!db) return empty;
    try {
      const row = db.prepare('SELECT * FROM speaker_profile_stats WHERE profile_id = ?')
        .get(SPEAKER_PROFILE_ME_ID) as Record<string, unknown> | undefined;
      if (!row) return empty;
      const avgLatencyMs = toFiniteNumber(row.avg_latency_ms);
      const lastVerifiedAt = toFiniteNumber(row.last_verified_at);
      const lastFailureAt = toFiniteNumber(row.last_failure_at);
      const lastRecordedAt = toFiniteNumber(row.last_recorded_at);
      return {
        totalVerifications: Number(row.total_verifications) || 0,
        positiveVerifications: Number(row.positive_verifications) || 0,
        lowQualitySkips: Number(row.low_quality_skips) || 0,
        lowConfidenceRejections: Number(row.low_confidence_rejections) || 0,
        nearThresholdNonMeCount: Number(row.near_threshold_non_me_count) || 0,
        errorCount: Number(row.error_count) || 0,
        timeoutCount: Number(row.timeout_count) || 0,
        latencySampleCount: Number(row.latency_sample_count) || 0,
        ...(avgLatencyMs !== undefined ? { avgLatencyMs } : {}),
        ...(lastVerifiedAt !== undefined ? { lastVerifiedAt } : {}),
        ...(lastFailureAt !== undefined ? { lastFailureAt } : {}),
        ...(typeof row.last_outcome === 'string'
          ? { lastOutcome: row.last_outcome as SpeakerVerificationOutcome }
          : {}),
        ...(typeof row.last_error === 'string' ? { lastError: row.last_error } : {}),
        ...(lastRecordedAt !== undefined ? { lastRecordedAt } : {}),
      };
    } catch {
      return empty;
    }
  }

  getVerificationStats(): SpeakerVerificationStats {
    return this.getStats();
  }

  recordVerification(result: 'verified' | 'low_quality' | 'error' | 'timeout', isMe?: boolean): void {
    const outcome: SpeakerVerificationOutcome = result === 'verified'
      ? (isMe ? 'positive' : 'low_confidence')
      : result;
    this.recordVerificationStat({ outcome });
  }

  recordVerificationStat(input: {
    outcome: SpeakerVerificationOutcome;
    latencyMs?: number;
    error?: string;
    nowMs?: number;
  }): void {
    const db = this.dbProvider.getDb();
    if (!db) return;
    const now = input.nowMs ?? Date.now();
    const latencyMs = toFiniteNumber(input.latencyMs);
    const latency = latencyMs !== undefined && latencyMs >= 0 ? latencyMs : null;
    const error = safeErrorCode(input.error);
    try {
      const positive = input.outcome === 'positive' ? 1 : 0;
      const lowQuality = input.outcome === 'low_quality' ? 1 : 0;
      const rejected = input.outcome === 'low_confidence' ? 1 : 0;
      const nearThreshold = input.outcome === 'near_threshold_non_me' ? 1 : 0;
      const errors = input.outcome === 'error' ? 1 : 0;
      const timeouts = input.outcome === 'timeout' ? 1 : 0;
      const verifiedAt = ['positive', 'low_confidence', 'near_threshold_non_me'].includes(input.outcome) ? now : null;
      const failureAt = input.outcome === 'positive' ? null : now;
      db.prepare(`
        INSERT INTO speaker_profile_stats (
          profile_id, total_verifications, positive_verifications, low_quality_skips,
          low_confidence_rejections, near_threshold_non_me_count, error_count, timeout_count,
          last_verified_at, last_failure_at, avg_latency_ms, latency_sample_count,
          last_outcome, last_error, last_recorded_at
        ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET
          total_verifications = total_verifications + 1,
          positive_verifications = positive_verifications + excluded.positive_verifications,
          low_quality_skips = low_quality_skips + excluded.low_quality_skips,
          low_confidence_rejections = low_confidence_rejections + excluded.low_confidence_rejections,
          near_threshold_non_me_count = near_threshold_non_me_count + excluded.near_threshold_non_me_count,
          error_count = error_count + excluded.error_count,
          timeout_count = timeout_count + excluded.timeout_count,
          last_verified_at = COALESCE(excluded.last_verified_at, last_verified_at),
          last_failure_at = COALESCE(excluded.last_failure_at, last_failure_at),
          avg_latency_ms = CASE
            WHEN excluded.latency_sample_count = 0 THEN avg_latency_ms
            WHEN latency_sample_count = 0 OR avg_latency_ms IS NULL THEN excluded.avg_latency_ms
            ELSE (avg_latency_ms * latency_sample_count + excluded.avg_latency_ms) / (latency_sample_count + 1)
          END,
          latency_sample_count = latency_sample_count + excluded.latency_sample_count,
          last_outcome = excluded.last_outcome,
          last_error = COALESCE(excluded.last_error, last_error),
          last_recorded_at = excluded.last_recorded_at
      `).run(
        SPEAKER_PROFILE_ME_ID,
        positive,
        lowQuality,
        rejected,
        nearThreshold,
        errors,
        timeouts,
        verifiedAt,
        failureAt,
        latency,
        latency === null ? 0 : 1,
        input.outcome,
        error ?? null,
        now,
      );
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
      threshold: resolveProfileThreshold(row.threshold),
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
