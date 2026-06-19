// electron/services/research/CompanyResearchCache.ts
import {
  DOSSIER_SCHEMA_VERSION,
  type CompanyDossier,
} from './types';

interface CacheHit {
  dossier: CompanyDossier;
  isExpired: () => boolean;
}

interface PreparedStatement {
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): { changes?: number };
}

interface DbConnection {
  prepare(sql: string): PreparedStatement;
  exec(sql: string): void;
}

export class CompanyResearchCache {
  private readonly stmtsByOp: {
    select: PreparedStatement;
    upsert: PreparedStatement;
    prune: PreparedStatement;
    deleteAll: PreparedStatement;
  };

  constructor(private readonly conn: { db: DbConnection }) {
    const { db } = conn;
    this.stmtsByOp = {
      select: db.prepare(
        `SELECT dossier_json, expires_at, schema_version
         FROM company_research_cache
         WHERE company_name = ?`,
      ),
      upsert: db.prepare(
        `INSERT INTO company_research_cache
          (company_name, company_name_display, dossier_json, generated_at, expires_at, source, schema_version)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(company_name) DO UPDATE SET
          company_name_display = excluded.company_name_display,
          dossier_json = excluded.dossier_json,
          generated_at = excluded.generated_at,
          expires_at = excluded.expires_at,
          source = excluded.source,
          schema_version = excluded.schema_version`,
      ),
      prune: db.prepare(
        `DELETE FROM company_research_cache WHERE expires_at < ?`,
      ),
      deleteAll: db.prepare(
        `DELETE FROM company_research_cache`,
      ),
    };
  }

  private normalize(name: string): string {
    return name.trim().toLowerCase().replace(/\s+/g, ' ');
  }

  async get(companyName: string): Promise<CacheHit | null> {
    const key = this.normalize(companyName);
    if (!key) return null;
    const row = this.stmtsByOp.select.get(key) as
      | { dossier_json: string; expires_at: string; schema_version: string }
      | undefined;
    if (!row) return null;
    if (row.schema_version !== DOSSIER_SCHEMA_VERSION) return null;
    let dossier: CompanyDossier;
    try {
      dossier = JSON.parse(row.dossier_json);
    } catch {
      return null;
    }
    const expiresAtMs = new Date(row.expires_at).getTime();
    return {
      dossier,
      isExpired: () => Date.now() > expiresAtMs,
    };
  }

  async put(companyName: string, dossier: CompanyDossier): Promise<void> {
    const key = this.normalize(companyName);
    this.stmtsByOp.upsert.run(
      key,
      dossier.companyName,
      JSON.stringify(dossier),
      dossier.generatedAt,
      dossier.expiresAt,
      dossier.source,
      DOSSIER_SCHEMA_VERSION,
    );
  }

  async prune(): Promise<number> {
    const result = this.stmtsByOp.prune.run(new Date().toISOString());
    return result.changes ?? 0;
  }

  async clearAll(): Promise<number> {
    const result = this.stmtsByOp.deleteAll.run();
    return result.changes ?? 0;
  }
}
