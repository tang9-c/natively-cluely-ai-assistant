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

describe('DocumentTextExtractor', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'doc-ext-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('extracts plain UTF-8 text from a .txt file', async () => {
    const filePath = path.join(tmpDir, 'resume.txt');
    fs.writeFileSync(filePath, '  Alice\nEngineer\n  ', 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text, 'Alice\nEngineer');
  });

  it('decodes UTF-16 LE with BOM', async () => {
    const filePath = path.join(tmpDir, 'utf16le.txt');
    const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('Hello World', 'utf16le')]);
    fs.writeFileSync(filePath, buf);
    const text = await DocumentTextExtractor.extract(filePath);
    assert.equal(text, 'Hello World');
  });

  it('extracts markdown text from a .md file', async () => {
    const filePath = path.join(tmpDir, 'resume.md');
    fs.writeFileSync(filePath, '# 唐九辰\n\n## 技能\n- Python\n- TypeScript\n\n[链接](https://example.com)', 'utf8');
    const text = await DocumentTextExtractor.extract(filePath);
    assert.ok(text.includes('唐九辰'));
    assert.ok(text.includes('Python'));
    assert.ok(text.includes('TypeScript'));
  });

  it('extracts text from a .pdf file', async () => {
    const filePath = path.join(tmpDir, 'faq.pdf');
    fs.writeFileSync(filePath, createMinimalPdf('CueUp PDF FAQ unique fact'));
    const text = await DocumentTextExtractor.extract(filePath);
    assert.match(text, /CueUp PDF FAQ unique fact/);
  });

  it('extracts text from a .docx file', async () => {
    const filePath = path.join(tmpDir, 'faq.docx');
    fs.writeFileSync(filePath, Buffer.from(MINIMAL_DOCX_BASE64, 'base64'));
    const text = await DocumentTextExtractor.extract(filePath);
    assert.match(text, /CueUp DOCX FAQ unique fact/);
  });

  it('rejects unsupported extensions', async () => {
    const filePath = path.join(tmpDir, 'resume.png');
    fs.writeFileSync(filePath, 'not used');
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /Unsupported file type/,
    );
  });

  it('rejects an empty file', async () => {
    const filePath = path.join(tmpDir, 'empty.txt');
    fs.writeFileSync(filePath, '');
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /empty/,
    );
  });

  it('rejects a .txt file containing binary data', async () => {
    const filePath = path.join(tmpDir, 'binary.txt');
    fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
    await assert.rejects(
      async () => DocumentTextExtractor.extract(filePath),
      /binary file/,
    );
  });
});
