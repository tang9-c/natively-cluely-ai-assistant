import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/security/FileAccessGrantStore.js');
const tempDirs = [];

async function loadStore() {
  return import(pathToFileURL(modulePath).href);
}

function createFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-file-grant-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'document.txt');
  fs.writeFileSync(filePath, 'authorized');
  return filePath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

test('file grants are bound to owner and purpose and can be consumed once', async () => {
  const { FileAccessGrantStore } = await loadStore();
  const store = new FileAccessGrantStore();
  const filePath = createFile();
  const token = store.issue(filePath, 'profile-document', 41);

  assert.throws(() => store.consume(token, 'profile-document', 42), /grant/i);

  const retryToken = store.issue(filePath, 'profile-document', 41);
  assert.equal(store.consume(retryToken, 'profile-document', 41), fs.realpathSync(filePath));
  assert.throws(() => store.consume(retryToken, 'profile-document', 41), /grant/i);
});

test('file grants reject a changed file target', async () => {
  const { FileAccessGrantStore } = await loadStore();
  const store = new FileAccessGrantStore();
  const filePath = createFile();
  const token = store.issue(filePath, 'chat-image', 7);
  fs.unlinkSync(filePath);
  fs.writeFileSync(filePath, 'replacement');

  assert.throws(() => store.consume(token, 'chat-image', 7), /changed/i);
});

test('profile document grants reject unsupported canonical file types', async () => {
  const { FileAccessGrantStore } = await loadStore();
  const store = new FileAccessGrantStore();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-file-grant-type-'));
  tempDirs.push(dir);
  const target = path.join(dir, 'credentials.env');
  fs.writeFileSync(target, 'secret');

  assert.throws(
    () => store.issue(target, 'profile-document', 42),
    /Unsupported profile document type/,
  );
});
