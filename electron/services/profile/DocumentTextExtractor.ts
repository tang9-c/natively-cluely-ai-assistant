import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const PARSE_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    if (typeof (timer as any).unref === 'function') {
      (timer as any).unref();
    }
    p.then(resolve, reject).finally(() => clearTimeout(timer));
  });
}

type CodedError = Error & { code?: string };

function classifyPdfRuntimeError(error: unknown): string | undefined {
  const codedError = error as CodedError;
  if (codedError?.code && ['ENOENT', 'EACCES', 'EPERM'].includes(codedError.code)) {
    return 'pdf_access_failed';
  }
  const message = String(codedError?.message || '').toLowerCase();
  if (message.includes('pdf parse timed out')) return 'pdf_parse_timeout';
  if (/worker|terminated|destroyed|transport/.test(message)) return 'pdf_worker_failed';
  return undefined;
}

function attachPdfRuntimeCode(error: unknown): CodedError {
  const normalized = error instanceof Error ? error as CodedError : new Error(String(error)) as CodedError;
  normalized.code = classifyPdfRuntimeError(normalized) || normalized.code;
  return normalized;
}

function isTransientPdfRuntimeError(error: unknown): boolean {
  const code = classifyPdfRuntimeError(error) || (error as CodedError)?.code;
  return code === 'pdf_parse_timeout' || code === 'pdf_worker_failed';
}

async function parsePdfOnce(buffer: Buffer, PDFParse: any): Promise<string> {
  const parser = new PDFParse({ data: buffer });
  try {
    const data: any = await withTimeout(parser.getText(), PARSE_TIMEOUT_MS, 'PDF parse');
    return data?.text ?? '';
  } finally {
    try {
      await parser.destroy();
    } catch {
      logPdfCleanupFailure();
    }
  }
}

function logPdfCleanupFailure(): void {
  console.warn('[DocumentTextExtractor] PDF parser cleanup failed', {
    code: 'pdf_cleanup_failed',
    stage: 'cleanup',
    platform: process.platform,
    arch: process.arch,
  });
}

export async function extractPdfTextWithParser(buffer: Buffer, PDFParse: any): Promise<string> {
  try {
    return await parsePdfOnce(buffer, PDFParse);
  } catch (firstError) {
    if (!isTransientPdfRuntimeError(firstError)) throw attachPdfRuntimeCode(firstError);
    try {
      return await parsePdfOnce(buffer, PDFParse);
    } catch (retryError) {
      throw attachPdfRuntimeCode(retryError);
    }
  }
}

export class DocumentTextExtractor {
  static async extract(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    let stats: fs.Stats;
    try {
      stats = fs.lstatSync(filePath);
    } catch (error) {
      if (ext === '.pdf') throw attachPdfRuntimeCode(error);
      throw error;
    }
    if (!stats.isFile()) {
      throw new Error('Selected path is not a regular file.');
    }

    let raw = '';
    try {
      if (ext === '.pdf') {
        raw = await this.extractPdf(filePath);
      } else if (ext === '.docx' || ext === '.doc') {
        raw = await this.extractDocx(filePath);
      } else if (ext === '.txt' || ext === '.md' || ext === '.markdown') {
        raw = this.extractPlainText(filePath);
      } else {
        throw new Error(`Unsupported file type "${ext}". Supported formats: PDF, DOCX, DOC, TXT, MD.`);
      }
    } catch (err: any) {
      if (err.message?.includes('Unsupported file type') || err.message?.includes('not a regular file')) {
        throw err;
      }
      const wrapped = new Error(`Could not parse document. ${err.message ?? err}`) as CodedError;
      wrapped.code = err?.code || (ext === '.pdf' ? classifyPdfRuntimeError(err) : undefined);
      throw wrapped;
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new Error('File appears to be empty or contains no extractable text.');
    }
    return trimmed;
  }

  private static async extractPdf(filePath: string): Promise<string> {
    const { PDFParse } = require('pdf-parse');
    PDFParse.setWorker(pathToFileURL(resolvePdfWorkerPath()).href);
    let buffer: Buffer;
    try {
      buffer = fs.readFileSync(filePath);
    } catch (error) {
      throw attachPdfRuntimeCode(error);
    }
    return extractPdfTextWithParser(buffer, PDFParse);
  }

  private static async extractDocx(filePath: string): Promise<string> {
    const mammoth = require('mammoth');
    const result: any = await withTimeout(
      mammoth.extractRawText({ path: filePath }),
      PARSE_TIMEOUT_MS,
      'DOCX parse',
    );
    return result?.value ?? '';
  }

  private static extractPlainText(filePath: string): string {
    const probe = fs.readFileSync(filePath, { encoding: null });
    if (probe.length === 0) return '';

    if (probe.length >= 2 && probe[0] === 0xff && probe[1] === 0xfe) {
      return probe.subarray(2).toString('utf16le');
    }
    if (probe.length >= 2 && probe[0] === 0xfe && probe[1] === 0xff) {
      const swapped = Buffer.allocUnsafe(probe.length - 2);
      for (let i = 2; i + 1 < probe.length; i += 2) {
        swapped[i - 2] = probe[i + 1];
        swapped[i - 1] = probe[i];
      }
      return swapped.toString('utf16le');
    }
    if (probe.length >= 3 && probe[0] === 0xef && probe[1] === 0xbb && probe[2] === 0xbf) {
      return probe.subarray(3).toString('utf8');
    }

    const sniffWindow = probe.subarray(0, Math.min(2048, probe.length));
    if (sniffWindow.includes(0)) {
      throw new Error('File looks like a binary file even though its extension is .txt.');
    }
    return probe.toString('utf8');
  }
}

function resolvePdfWorkerPath(): string {
  const bundledWorkerPath = path.resolve(__dirname, '../../pdf.worker.mjs');
  if (fs.existsSync(bundledWorkerPath)) {
    return bundledWorkerPath;
  }
  return path.resolve(process.cwd(), 'node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs');
}
