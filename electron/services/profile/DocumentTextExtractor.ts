import fs from 'fs';
import path from 'path';

const PARSE_TIMEOUT_MS = 15_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      if (typeof (t as any).unref === 'function') {
        (t as any).unref();
      }
    }),
  ]);
}

export class DocumentTextExtractor {
  static async extract(filePath: string): Promise<string> {
    const ext = path.extname(filePath).toLowerCase();
    const stats = fs.lstatSync(filePath);
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
      throw new Error(`Could not parse document. ${err.message ?? err}`);
    }

    const trimmed = raw.trim();
    if (trimmed.length === 0) {
      throw new Error('File appears to be empty or contains no extractable text.');
    }
    return trimmed;
  }

  private static async extractPdf(filePath: string): Promise<string> {
    const { PDFParse } = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const parser = new PDFParse({ data: buffer });
    const data: any = await withTimeout(parser.getText(), PARSE_TIMEOUT_MS, 'PDF parse');
    return data?.text ?? '';
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
