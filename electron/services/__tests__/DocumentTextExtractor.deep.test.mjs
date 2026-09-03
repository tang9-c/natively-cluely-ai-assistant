// electron/services/__tests__/DocumentTextExtractor.deep.test.mjs
//
// Phase 6 deep coverage for DocumentTextExtractor.
// Targets:
//   - extract(filePath) extension dispatch and error wrapping
//   - extractPdf / extractDocx via real fixtures (minimal PDF / minimal DOCX)
//   - extractPlainText encoding detection (UTF-8 / UTF-16 LE / UTF-16 BE / UTF-8 BOM / binary)
//   - Boundary cases: whitespace-only, very small, very long single line,
//     mixed-case extension, .doc (legacy)
//   - Error paths: directory (EISDIR), permission denied (chmod 000)

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { DocumentTextExtractor } = require('../../../dist-electron/electron/services/profile/DocumentTextExtractor.js');

// Minimal DOCX base64 — already used by the base test file. Three internal
// parts: [Content_Types].xml, _rels/.rels, word/document.xml
const MINIMAL_DOCX_BASE64 = 'UEsDBBQAAAAIAEkT5lzXeYTq8QAAALgBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2QzU7DMBCE730Ky9cqccoBIZSkB36OwKE8wMreJFb9J69b2rdn00KREOVozXwz62nXB+/EHjPZGDq5qhspMOhobBg7+b55ru6koALBgIsBO3lEkut+0W6OCUkwHKiTUynpXinSE3qgOiYMrAwxeyj8zKNKoLcworppmlulYygYSlXmDNkvhGgfcYCdK+LpwMr5loyOpHg4e+e6TkJKzmoorKt9ML+Kqq+SmsmThyabaMkGqa6VzOL1jh/0lSfK1qB4g1xewLNRfcRslIl65xmu/0/649o4DFbjhZ/TUo4aiXh77+qL4sGG71+06jR8/wlQSwMEFAAAAAgASRPmXCAbhuqyAAAALgEAAAsAAABfcmVscy8ucmVsc43Puw6CMBQG4J2naM4uBQdjDIXFmLAafICmPZRGeklbL7y9HRzEODie23fyN93TzOSOIWpnGdRlBQStcFJbxeAynDZ7IDFxK/nsLDJYMELXFs0ZZ57yTZy0jyQjNjKYUvIHSqOY0PBYOo82T0YXDE+5DIp6Lq5cId1W1Y6GTwPagpAVS3rJIPSyBjIsHv/h3ThqgUcnbgZt+vHlayPLPChMDB4uSCrf7TKzQHNKuorZvgBQSwMEFAAAAAgASRPmXO7yi1CwAAAA5AAAABEAAAB3b3JkL2RvY3VtZW50LnhtbEWOywrCMBBF935FyF5TXYiUPhDFrQgW3MZkbAvNTExSq39vUhduzmW4cO4U9dsM7AXO94QlX68yzgAV6R7bkjfX03LHmQ8StRwIoeQf8LyuFsWUa1KjAQwsGtDnU8m7EGwuhFcdGOlXZAFj9yBnZIina8VETltHCryPA2YQmyzbCiN75FVU3kl/UtoElxCqwwiNZcfz4cZO+wsbsX+OwB5ShUKkPtHNtDN/DvH/r/oCUEsBAhQDFAAAAAgASRPmXNd5hOrxAAAAuAEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABJE+ZcIBuG6rIAAAAuAQAACwAAAAAAAAAAAAAAgAEiAQAAX3JlbHMvLnJlbHNQSwECFAMUAAAACABJE+Zc7vKLULAAAADkAAAAEQAAAAAAAAAAAAAAgAH9AQAAd29yZC9kb2N1bWVudC54bWxQSwUGAAAAAAMAAwC5AAAA3AIAAAAA';

function createMinimalPdf(text) {
  const objects = [];
  const add = (source) => objects.push(source);
  add('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  add('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n');
  add('3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n');
  add('4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n');
  const stream = `BT /F1 18 Tf 72 720 Td (${text}) Tj ET`;
  add(`5 0 obj\n<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream\nendobj\n`);

  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(output));
    output += object;
  }
  const xrefOffset = Buffer.byteLength(output);
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index < offsets.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return output;
}

describe('DocumentTextExtractor — extension dispatch (uppercase + multi-format)', () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ext-deep-'));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('treats uppercase .PDF as PDF', async () => {
    const filePath = path.join(tmpDir, 'caps.PDF');
    fs.writeFileSync(filePath, createMinimalPdf('CueUp caps PDF'));
    const text = await DocumentTextExtractor.extract(filePath);
    assert.match(text, /CueUp caps PDF/);
  });

  it('treats uppercase .TXT as plain text', async () => {
    const filePath = path.join(tmpDir, 'caps.TXT');
    fs.writeFileSync(filePath, 'uppercase txt extension works', 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text, 'uppercase txt extension works');
  });

  it('handles .md same as .markdown same as .txt', async () => {
    const md = path.join(tmpDir, 'a.md');
    const mk = path.join(tmpDir, 'b.markdown');
    const tx = path.join(tmpDir, 'c.txt');
    fs.writeFileSync(md, 'md body', 'utf8');
    fs.writeFileSync(mk, 'markdown body', 'utf8');
    fs.writeFileSync(tx, 'txt body', 'utf8');
    assert.equal(await DocumentTextExtractor.extract(md), 'md body');
    assert.equal(await DocumentTextExtractor.extract(mk), 'markdown body');
    assert.equal(await DocumentTextExtractor.extract(tx), 'txt body');
  });

  it('rejects .doc legacy format (mammoth cannot read it)', async () => {
    const filePath = path.join(tmpDir, 'legacy.doc');
    // The legacy .doc binary structure confuses mammoth — we just verify it
    // doesn't throw a "Unsupported file type" error (it's supported, just
    // unparseable). Either it returns "" (which would then trip the
    // "empty/no extractable text" path) or it throws a parse error wrapped
    // with "Could not parse document". Both are acceptable behavior for this
    // fixture.
    fs.writeFileSync(filePath, Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]));
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /Could not parse document|empty/,
    );
  });

  it('rejects unknown extension with explicit "Unsupported file type" message', async () => {
    const filePath = path.join(tmpDir, 'weird.xyz');
    fs.writeFileSync(filePath, 'whatever');
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /Unsupported file type/,
    );
  });
});

describe('DocumentTextExtractor — encoding detection', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ext-enc-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('decodes plain UTF-8 (no BOM) correctly', async () => {
    const filePath = path.join(tmpDir, 'plain.txt');
    fs.writeFileSync(filePath, '中文 + emoji 🎉', 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text, '中文 + emoji 🎉');
  });

  it('decodes UTF-8 with BOM and drops the BOM', async () => {
    const filePath = path.join(tmpDir, 'utf8bom2.txt');
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('BOM-OK', 'utf8')]);
    fs.writeFileSync(filePath, buf);
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text, 'BOM-OK');
    assert.equal(text.charCodeAt(0), 0x42); // 'B' — no BOM character
  });

  it('decodes UTF-16 LE with BOM', async () => {
    const filePath = path.join(tmpDir, 'u16le.txt');
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('LE-UTF16', 'utf16le')]);
    fs.writeFileSync(filePath, buf);
    assert.equal(await DocumentTextExtractor.extract(filePath), 'LE-UTF16');
  });

  it('decodes UTF-16 BE with BOM by byte-swapping', async () => {
    const utf16le = Buffer.from('BE-utf16', 'utf16le');
    const utf16be = Buffer.allocUnsafe(utf16le.length);
    for (let i = 0; i < utf16le.length; i += 2) {
      utf16be[i] = utf16le[i + 1];
      utf16be[i + 1] = utf16le[i];
    }
    const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), utf16be]);
    const filePath = path.join(tmpDir, 'u16be.txt');
    fs.writeFileSync(filePath, buf);
    assert.equal(await DocumentTextExtractor.extract(filePath), 'BE-utf16');
  });
});

describe('DocumentTextExtractor — boundaries', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ext-bnd-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('rejects whitespace-only files as "empty or no extractable text"', async () => {
    const filePath = path.join(tmpDir, 'ws.txt');
    fs.writeFileSync(filePath, '   \n\n  \t\t \n', 'utf8');
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /empty or contains no extractable text/,
    );
  });

  it('handles a very small non-empty file (single char)', async () => {
    const filePath = path.join(tmpDir, 'one.txt');
    fs.writeFileSync(filePath, 'x', 'utf8');
    assert.equal(await DocumentTextExtractor.extract(filePath), 'x');
  });

  it('handles a very long single-line file (50k chars)', async () => {
    const filePath = path.join(tmpDir, 'long.txt');
    fs.writeFileSync(filePath, 'A'.repeat(50000), 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text.length, 50000);
  });

  it('accepts a plain-text file exactly at the 10 MiB profile limit', async () => {
    const filePath = path.join(tmpDir, 'limit.txt');
    fs.writeFileSync(filePath, 'A'.repeat(10 * 1024 * 1024), 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text.length, 10 * 1024 * 1024);
  });

  it('rejects a profile document larger than 10 MiB before parsing', async () => {
    const filePath = path.join(tmpDir, 'too-large.txt');
    fs.writeFileSync(filePath, '');
    fs.truncateSync(filePath, 10 * 1024 * 1024 + 1);
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      (error) => error?.code === 'profile_document_too_large' && /maximum is 10 MB/.test(error.message),
    );
  });

  it('rejects a binary file marked as .txt (contains NUL byte)', async () => {
    const filePath = path.join(tmpDir, 'bintxt.txt');
    // 2048 bytes with a NUL embedded — well within the sniff window
    const buf = Buffer.alloc(2048, 0x41);
    buf[1000] = 0x00;
    fs.writeFileSync(filePath, buf);
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /binary file/,
    );
  });

  it('rejects a directory passed as filePath (lstatSync.isFile() false)', async () => {
    await assert.rejects(
      async () => DocumentTextExtractor.extract(tmpDir),
      /not a regular file/,
    );
  });

  it('rejects a non-existent path (lstatSync ENOENT)', async () => {
    const missing = path.join(tmpDir, 'missing.txt');
    await assert.rejects(
      async () => DocumentTextExtractor.extract(missing),
      /ENOENT/,
    );
  });
});

describe('DocumentTextExtractor — PDF and DOCX error wrapping', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ext-err-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('extracts text from a valid PDF', async () => {
    const filePath = path.join(tmpDir, 'good.pdf');
    fs.writeFileSync(filePath, createMinimalPdf('CueUp valid PDF fixture'));
    const text = await DocumentTextExtractor.extract(filePath);
    assert.match(text, /CueUp valid PDF fixture/);
  });

  it('extracts text from a valid DOCX', async () => {
    const filePath = path.join(tmpDir, 'good.docx');
    fs.writeFileSync(filePath, Buffer.from(MINIMAL_DOCX_BASE64, 'base64'));
    const text = await DocumentTextExtractor.extract(filePath);
    assert.match(text, /CueUp DOCX FAQ unique fact/);
  });

  it('wraps corrupted PDF error as "Could not parse document"', async () => {
    const filePath = path.join(tmpDir, 'bad.pdf');
    fs.writeFileSync(filePath, '%PDF-1.4\nthis is not a real pdf\n');
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /Could not parse document/,
    );
  });

  it('wraps corrupted DOCX error as "Could not parse document"', async () => {
    const filePath = path.join(tmpDir, 'bad.docx');
    // Random bytes that aren't a valid ZIP/DOCX
    fs.writeFileSync(filePath, Buffer.from('not a zip docx at all'));
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /Could not parse document/,
    );
  });
});

describe('DocumentTextExtractor — special extensions', () => {
  let tmpDir;
  beforeEach(() => { tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ext-special-')); });
  afterEach(() => { fs.rmSync(tmpDir, { recursive: true, force: true }); });

  it('treats a file with no extension as unsupported', async () => {
    const filePath = path.join(tmpDir, 'noext');
    fs.writeFileSync(filePath, 'no extension here', 'utf8');
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /Unsupported file type/,
    );
  });

  it('extracts from .markdown (same path as .md/.txt)', async () => {
    const filePath = path.join(tmpDir, 'a.markdown');
    fs.writeFileSync(filePath, '# Markdown\n\n- a\n- b\n', 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.match(text, /Markdown/);
    assert.match(text, /- a/);
  });

  it('handles .TXT suffix with mixed case via toLowerCase dispatch', async () => {
    const filePath = path.join(tmpDir, 'mixed.Txt');
    fs.writeFileSync(filePath, 'mixed case is fine', 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text, 'mixed case is fine');
  });
});
