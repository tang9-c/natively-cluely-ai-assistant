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
