import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const compiledPath = path.resolve(root, 'dist-electron/electron/services/SecureStorage.js');

function installStub(req, id, exports) {
  const stub = new Module(id);
  stub.exports = exports;
  stub.loaded = true;
  req.cache[id] = stub;
  try {
    req.cache[req.resolve(id)] = stub;
  } catch {
    // Bare module ids like "electron" will land here in plain Node.
  }
}

async function loadSecureStorage({ userDataDir, nativeModule }) {
  const req = createRequire(import.meta.url);
  delete req.cache[compiledPath];
  globalThis.__NATIVELY_SECURE_STORAGE_LOAD_NATIVE_MODULE__ = () => nativeModule;

  installStub(req, 'electron', {
    app: {
      getAppPath() {
        return root;
      },
      isPackaged: false,
      getPath(name) {
        if (name === 'userData') return userDataDir;
        return os.tmpdir();
      },
    },
  });

  return req(compiledPath);
}

function withPatchedRenameSync(impl, fn) {
  const original = fs.renameSync;
  fs.renameSync = (from, to) => impl(original, from, to);
  try {
    return fn();
  } finally {
    fs.renameSync = original;
  }
}

function tamperEncryptedFile(filePath) {
  const blob = fs.readFileSync(filePath);
  blob[blob.length - 1] ^= 0x01;
  fs.writeFileSync(filePath, blob);
}

test('SecureStorage round-trips encrypted JSON with native hardware id', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-secure-storage-'));
  const secureStorage = await loadSecureStorage({
    userDataDir,
    nativeModule: { getHardwareId: () => 'test-hwid-abc' },
  });

  const filePath = path.join(userDataDir, 'credentials.enc');
  secureStorage.init();
  secureStorage.encryptJSON(filePath, { foo: 'bar' });

  assert.ok(fs.existsSync(filePath), 'encrypted credentials file should exist');
  assert.equal(
    fs.readFileSync(path.join(userDataDir, 'master.hwid'), 'utf8'),
    'test-hwid-abc'.slice(0, 16),
  );
  const blob = fs.readFileSync(filePath);
  assert.equal(blob.subarray(0, 9).toString('utf8'), 'NATIVELY:');
  assert.equal(blob[9], 0x02);
  assert.throws(() => JSON.parse(blob.toString('utf8')), /Unexpected token|Unexpected end of JSON input/);

  const parsed = secureStorage.decryptJSON(filePath);
  assert.deepEqual(parsed, { foo: 'bar' });
});

test('SecureStorage deletes tampered ciphertext and marks device key lost', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-secure-storage-'));
  const secureStorage = await loadSecureStorage({
    userDataDir,
    nativeModule: { getHardwareId: () => 'test-hwid-abc' },
  });

  const filePath = path.join(userDataDir, 'credentials.enc');
  secureStorage.init();
  secureStorage.encryptJSON(filePath, { token: 'secret' });
  tamperEncryptedFile(filePath);

  const parsed = secureStorage.decryptJSON(filePath);
  assert.equal(parsed, undefined);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(secureStorage.getDeviceKeyLost(), true);
});

test('SecureStorage deletes legacy plaintext files instead of loading them', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-secure-storage-'));
  const filePath = path.join(userDataDir, 'credentials.enc');
  fs.writeFileSync(filePath, JSON.stringify({ plain: 'old' }), 'utf8');

  const secureStorage = await loadSecureStorage({
    userDataDir,
    nativeModule: { getHardwareId: () => 'test-hwid-abc' },
  });

  secureStorage.init();
  assert.equal(secureStorage.decryptJSON(filePath), undefined);
  assert.equal(fs.existsSync(filePath), false);
});

test('SecureStorage falls back to software fingerprint when native module is unavailable', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-secure-storage-'));
  const secureStorage = await loadSecureStorage({
    userDataDir,
    nativeModule: null,
  });

  const filePath = path.join(userDataDir, 'credentials.enc');
  secureStorage.init();
  secureStorage.encryptJSON(filePath, { hello: 'world' });

  assert.deepEqual(secureStorage.decryptJSON(filePath), { hello: 'world' });
});

test('SecureStorage wipes credentials when stored fingerprint no longer matches', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-secure-storage-'));
  const first = await loadSecureStorage({
    userDataDir,
    nativeModule: { getHardwareId: () => 'test-hwid-abc' },
  });

  const filePath = path.join(userDataDir, 'credentials.enc');
  first.init();
  first.encryptJSON(filePath, { persisted: true });

  fs.writeFileSync(path.join(userDataDir, 'master.hwid'), 'mismatch-hwid-000', 'utf8');

  const second = await loadSecureStorage({
    userDataDir,
    nativeModule: { getHardwareId: () => 'other-hwid-xyz' },
  });

  second.init();
  assert.equal(second.decryptJSON(filePath), undefined);
  assert.equal(fs.existsSync(filePath), false);
  assert.equal(second.getDeviceKeyLost(), true);
});

test('SecureStorage retries overwrite on win32 when rename hits existing-target semantics', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'natively-secure-storage-'));
  globalThis.__NATIVELY_SECURE_STORAGE_PLATFORM__ = 'win32';
  try {
    const secureStorage = await loadSecureStorage({
      userDataDir,
      nativeModule: { getHardwareId: () => 'test-hwid-abc' },
    });

    const filePath = path.join(userDataDir, 'credentials.enc');
    secureStorage.init();
    secureStorage.encryptJSON(filePath, { version: 1 });

    let firstAttempt = true;
    withPatchedRenameSync((originalRenameSync, from, to) => {
      if (firstAttempt && to === filePath) {
        firstAttempt = false;
        const error = new Error('destination exists');
        error.code = 'EEXIST';
        throw error;
      }
      return originalRenameSync(from, to);
    }, () => {
      secureStorage.encryptJSON(filePath, { version: 2 });
    });

    assert.deepEqual(secureStorage.decryptJSON(filePath), { version: 2 });
  } finally {
    delete globalThis.__NATIVELY_SECURE_STORAGE_PLATFORM__;
  }
});
