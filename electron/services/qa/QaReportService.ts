import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import type { AnswerQualityMetrics } from '../../db/DatabaseManager';
import {
  aggregateDynamicActionQaMetrics,
  parseTelemetryJsonlLines,
  type TelemetryLikeRecord,
} from './DynamicActionMetricsAggregator';

export interface QaReportServiceDeps {
  now?: () => Date;
  appVersion: string;
  platform?: NodeJS.Platform;
  arch?: string;
  verboseLoggingEnabled: () => boolean;
  telemetryPath: string;
  debugLogPaths: string[];
  getAnswerQualityMetrics: (input: { sinceMs: number }) => AnswerQualityMetrics | null;
}

export interface CreateQaReportInput {
  outputPath: string;
}

export interface CreateQaReportResult {
  success: boolean;
  filePath?: string;
  error?: string;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export class QaReportService {
  constructor(private readonly deps: QaReportServiceDeps) {}

  async createQaReport(input: CreateQaReportInput): Promise<CreateQaReportResult> {
    const now = this.deps.now?.() ?? new Date();
    const sinceMs = now.getTime() - SEVEN_DAYS_MS;
    const zip = new JSZip();
    const includedFiles: string[] = [];
    const missingFiles: string[] = [];
    const reportWarnings: string[] = [];
    let telemetryRecords: TelemetryLikeRecord[] = [];

    const telemetry = this.readFileIfRecent(this.deps.telemetryPath, sinceMs, 'telemetry.jsonl', missingFiles, reportWarnings);
    if (telemetry !== null) {
      zip.file('telemetry.jsonl', telemetry);
      includedFiles.push('telemetry.jsonl');
      const parsed = parseTelemetryJsonlLines(telemetry);
      telemetryRecords = parsed.records;
      reportWarnings.push(...parsed.warnings);
    }

    for (const debugPath of this.deps.debugLogPaths) {
      const name = path.basename(debugPath);
      const content = this.readFileIfRecent(debugPath, sinceMs, name, missingFiles, reportWarnings);
      if (content !== null) {
        zip.file(name, content);
        includedFiles.push(name);
      }
    }

    let answerQualityMetrics: AnswerQualityMetrics | null = null;
    try {
      answerQualityMetrics = this.deps.getAnswerQualityMetrics({ sinceMs });
    } catch (error) {
      reportWarnings.push(`SQLite quality metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const summary = aggregateDynamicActionQaMetrics({
      telemetryRecords,
      fixtureResults: [],
      answerQualityMetrics,
    });
    zip.file('quality-summary.json', JSON.stringify(summary, null, 2));
    includedFiles.push('quality-summary.json');

    const metadata = {
      appVersion: this.deps.appVersion,
      exportedAt: now.toISOString(),
      dateRange: { since: new Date(sinceMs).toISOString(), until: now.toISOString() },
      platform: this.deps.platform ?? process.platform,
      arch: this.deps.arch ?? process.arch,
      hostname: os.hostname(),
      verboseLoggingEnabled: this.deps.verboseLoggingEnabled(),
      includedFiles,
      missingFiles,
      reportWarnings,
    };
    zip.file('metadata.json', JSON.stringify(metadata, null, 2));

    try {
      fs.mkdirSync(path.dirname(input.outputPath), { recursive: true });
      const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
      fs.writeFileSync(input.outputPath, buffer);
      return { success: true, filePath: input.outputPath };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private readFileIfRecent(
    filePath: string,
    sinceMs: number,
    zipName: string,
    missingFiles: string[],
    warnings: string[],
  ): string | null {
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < sinceMs) {
        warnings.push(`${zipName} omitted because its mtime is outside the 7 day window`);
        return null;
      }
      return fs.readFileSync(filePath, 'utf8');
    } catch {
      missingFiles.push(zipName);
      warnings.push(`${zipName} missing`);
      return null;
    }
  }
}
