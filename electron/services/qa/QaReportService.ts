import fs from 'fs';
import os from 'os';
import path from 'path';
import JSZip from 'jszip';
import type { AnswerQualityMetrics } from '../../db/DatabaseManager';
import {
  aggregateDynamicActionQaMetrics,
  parseTelemetryJsonlLines,
  type AggregatorFixtureResult,
  type TelemetryLikeRecord,
} from './DynamicActionMetricsAggregator';
import { redactForLog, redactValue } from '../../utils/redactForLog';

export interface QaReportServiceDeps {
  now?: () => Date;
  appVersion: string;
  platform?: NodeJS.Platform;
  arch?: string;
  verboseLoggingEnabled: () => boolean;
  telemetryPath: string;
  debugLogPaths: string[];
  dynamicActionReportPaths?: {
    productReportPath: string;
    replayReportPath: string;
    metricsReportPath: string;
  };
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
      zip.file('telemetry.jsonl', this.sanitizeTelemetryJsonl(telemetry));
      includedFiles.push('telemetry.jsonl');
      const parsed = parseTelemetryJsonlLines(telemetry);
      telemetryRecords = parsed.records;
      reportWarnings.push(...parsed.warnings);
    }

    for (const debugPath of this.deps.debugLogPaths) {
      const name = path.basename(debugPath);
      const content = this.readFileIfRecent(debugPath, sinceMs, name, missingFiles, reportWarnings);
      if (content !== null) {
        zip.file(name, this.sanitizeLogContent(content));
        includedFiles.push(name);
      }
    }

    const dynamicActionReports = this.readDynamicActionReports(zip, sinceMs, includedFiles, missingFiles, reportWarnings);

    let answerQualityMetrics: AnswerQualityMetrics | null = null;
    try {
      answerQualityMetrics = this.deps.getAnswerQualityMetrics({ sinceMs });
    } catch (error) {
      reportWarnings.push(`SQLite quality metrics unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }

    const summary = aggregateDynamicActionQaMetrics({
      telemetryRecords,
      fixtureResults: toAggregatorFixtureResults(dynamicActionReports.productReport?.results),
      replayReport: dynamicActionReports.replayReport,
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

  private readDynamicActionReports(
    zip: JSZip,
    sinceMs: number,
    includedFiles: string[],
    missingFiles: string[],
    warnings: string[],
  ): {
    productReport: { results?: unknown[] } | null;
    replayReport: any | null;
    metricsReport: any | null;
  } {
    const paths = this.deps.dynamicActionReportPaths;
    if (!paths) {
      warnings.push('dynamic action QA report paths not configured');
      return { productReport: null, replayReport: null, metricsReport: null };
    }

    const productReport = this.readJsonReport(
      paths.productReportPath,
      zip,
      sinceMs,
      includedFiles,
      'dynamic-actions/product-report.json',
      missingFiles,
      warnings,
    );
    const replayReport = this.readJsonReport(
      paths.replayReportPath,
      zip,
      sinceMs,
      includedFiles,
      'dynamic-actions/replay-report.json',
      missingFiles,
      warnings,
    );
    const metricsReport = this.readJsonReport(
      paths.metricsReportPath,
      zip,
      sinceMs,
      includedFiles,
      'dynamic-actions/metrics-report.json',
      missingFiles,
      warnings,
    );
    return { productReport, replayReport, metricsReport };
  }

  private readJsonReport(
    filePath: string,
    zip: JSZip,
    sinceMs: number,
    includedFiles: string[],
    zipName: string,
    missingFiles: string[],
    warnings: string[],
  ): any | null {
    const content = this.readFileIfRecent(filePath, sinceMs, zipName, missingFiles, warnings);
    if (content === null) return null;
    try {
      const parsed = JSON.parse(content);
      zip.file(zipName, JSON.stringify(redactValue(parsed), null, 2));
      includedFiles.push(zipName);
      return parsed;
    } catch (error) {
      warnings.push(`${zipName} omitted because JSON parsing failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
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

  private sanitizeTelemetryJsonl(content: string): string {
    return content
      .split(/\r?\n/)
      .map((line) => {
        if (!line.trim()) return line;
        try {
          return JSON.stringify(redactValue(JSON.parse(line)));
        } catch {
          return this.sanitizeLogLine(line);
        }
      })
      .join('\n');
  }

  private sanitizeLogContent(content: string): string {
    return content
      .split(/\r?\n/)
      .map((line) => line ? this.sanitizeLogLine(line) : line)
      .join('\n');
  }

  private sanitizeLogLine(line: string): string {
    return redactForLog([line])
      .replace(/\b(transcript|prompt|body|referenceContent|evidenceText|screenshot|base64)\b\s*[:=]?\s*[^,\n\r\t}]*/gi, '$1 [REMOVED]')
      .replace(/\b(apiKey|authorization|bearer|token|secret|password|credential)\b\s*[:=]?\s*[^,\n\r\t}]*/gi, '$1 [REDACTED]');
  }
}

function toAggregatorFixtureResults(results: unknown): AggregatorFixtureResult[] {
  if (!Array.isArray(results)) return [];
  return results.filter((result): result is AggregatorFixtureResult => {
    if (!result || typeof result !== 'object') return false;
    const candidate = result as Partial<AggregatorFixtureResult>;
    return typeof candidate.fixtureId === 'string'
      && typeof candidate.shouldEmit === 'boolean'
      && typeof candidate.emitted === 'boolean'
      && typeof candidate.actionTypeMatched === 'boolean'
      && typeof candidate.outputTypeMatched === 'boolean';
  });
}
