"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DocumentTextExtractor = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const PARSE_TIMEOUT_MS = 15_000;
function withTimeout(p, ms, label) {
    return Promise.race([
        p,
        new Promise((_, reject) => {
            const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            if (typeof t.unref === 'function') {
                t.unref();
            }
        }),
    ]);
}
class DocumentTextExtractor {
    static async extract(filePath) {
        const ext = path_1.default.extname(filePath).toLowerCase();
        const stats = fs_1.default.lstatSync(filePath);
        if (!stats.isFile()) {
            throw new Error('Selected path is not a regular file.');
        }
        let raw = '';
        try {
            if (ext === '.pdf') {
                raw = await this.extractPdf(filePath);
            }
            else if (ext === '.docx' || ext === '.doc') {
                raw = await this.extractDocx(filePath);
            }
            else if (ext === '.txt') {
                raw = this.extractPlainText(filePath);
            }
            else {
                throw new Error(`Unsupported file type "${ext}". Supported formats: PDF, DOCX, DOC, TXT.`);
            }
        }
        catch (err) {
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
    static async extractPdf(filePath) {
        const { PDFParse } = require('pdf-parse');
        const buffer = fs_1.default.readFileSync(filePath);
        const parser = new PDFParse({ data: buffer });
        const data = await withTimeout(parser.getText(), PARSE_TIMEOUT_MS, 'PDF parse');
        return data?.text ?? '';
    }
    static async extractDocx(filePath) {
        const mammoth = require('mammoth');
        const result = await withTimeout(mammoth.extractRawText({ path: filePath }), PARSE_TIMEOUT_MS, 'DOCX parse');
        return result?.value ?? '';
    }
    static extractPlainText(filePath) {
        const probe = fs_1.default.readFileSync(filePath, { encoding: null });
        if (probe.length === 0)
            return '';
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
exports.DocumentTextExtractor = DocumentTextExtractor;
//# sourceMappingURL=DocumentTextExtractor.js.map