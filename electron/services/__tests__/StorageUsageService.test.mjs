import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../../..');
const modulePath = path.join(root, 'dist-electron/electron/services/StorageUsageService.js');

test('large directory scans and deletions do not use blocking filesystem calls', () => {
  const source = fs.readFileSync(path.join(root, 'electron/services/StorageUsageService.ts'), 'utf8');
  assert.doesNotMatch(source, /readdirSync|rmSync/);
});

function writeFile(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.alloc(bytes, 1));
}

function makeHarness(options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-storage-'));
  const userDataDir = path.join(tempDir, 'CueUp');
  const appDataDir = path.join(tempDir, 'Application Support');
  const bundledModelsDir = path.join(tempDir, 'resources', 'models');
  fs.mkdirSync(userDataDir, { recursive: true });
  fs.mkdirSync(appDataDir, { recursive: true });

  const { StorageUsageService } = require(modulePath);
  const service = new StorageUsageService({
    userDataDir,
    appDataDir,
    bundledModelsDir,
    knownModels: {
      whisper: [{ id: 'Xenova/whisper-base', name: 'Whisper Base' }],
      sensevoice: [{ id: 'sensevoice-small', name: 'SenseVoice Small' }],
    },
    isModelInUse: options.isModelInUse ?? (() => false),
  });

  return {
    tempDir,
    userDataDir,
    appDataDir,
    bundledModelsDir,
    service,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true }),
  };
}

test('getStorageUsage classifies bundled models, downloaded models, caches, and migrated legacy data', async () => {
  const h = makeHarness();
  try {
    writeFile(path.join(h.bundledModelsDir, 'embedding', 'model.onnx'), 11);
    writeFile(path.join(h.userDataDir, 'whisper-models/Xenova/whisper-base/model.onnx'), 13);
    writeFile(path.join(h.userDataDir, 'sensevoice-models/sensevoice-small/model.onnx'), 17);
    writeFile(path.join(h.userDataDir, 'models/speaker/model.onnx'), 7);
    writeFile(path.join(h.userDataDir, 'Cache/cache.bin'), 19);
    writeFile(path.join(h.userDataDir, 'Code Cache/code.bin'), 23);

    const legacyDir = path.join(h.appDataDir, 'Natively');
    writeFile(path.join(legacyDir, 'natively.db'), 29);
    writeFile(path.join(legacyDir, 'credentials.enc'), 31);
    writeFile(path.join(h.userDataDir, 'natively.db'), 37);
    writeFile(path.join(h.userDataDir, 'credentials.enc'), 41);
    writeFile(path.join(h.userDataDir, '.legacy-natively-migration-complete.json'), 1);

    const summary = await h.service.getStorageUsage();
    assert.equal(summary.appModels.bytes, 11);
    assert.equal(summary.downloadedModels.bytes, 37);
    assert.equal(summary.caches.bytes, 42);
    assert.equal(summary.legacyData.bytes, 60);
    assert.equal(summary.legacyData.items[0].removable, true);
    assert.equal(summary.reclaimableBytes, 90);
  } finally {
    h.cleanup();
  }
});

test('symbolic links are not followed or offered for deletion', async (t) => {
  const h = makeHarness();
  try {
    const outside = path.join(h.tempDir, 'outside');
    writeFile(path.join(outside, 'private.bin'), 101);
    const modelPath = path.join(h.userDataDir, 'whisper-models/Xenova/whisper-base');
    fs.mkdirSync(path.dirname(modelPath), { recursive: true });
    try {
      fs.symlinkSync(outside, modelPath, 'dir');
    } catch (error) {
      if (error?.code === 'EPERM') return t.skip('symlinks unavailable');
      throw error;
    }

    const summary = await h.service.getStorageUsage();
    assert.equal(summary.downloadedModels.bytes, 0);
    const result = await h.service.deleteDownloadedModel('whisper', 'Xenova/whisper-base');
    assert.deepEqual(result, { success: false, error: 'unsafe_symbolic_link' });
    assert.equal(fs.existsSync(path.join(outside, 'private.bin')), true);
  } finally {
    h.cleanup();
  }
});

test('unknown and traversal model ids cannot escape approved roots', async () => {
  const h = makeHarness();
  try {
    writeFile(path.join(h.tempDir, 'outside.bin'), 7);
    assert.deepEqual(
      await h.service.deleteDownloadedModel('whisper', '../../outside.bin'),
      { success: false, error: 'unknown_model' },
    );
    assert.deepEqual(
      await h.service.deleteDownloadedModel('sensevoice', 'unknown-model'),
      { success: false, error: 'unknown_model' },
    );
    assert.equal(fs.existsSync(path.join(h.tempDir, 'outside.bin')), true);
  } finally {
    h.cleanup();
  }
});

test('a model in use cannot be deleted', async () => {
  const h = makeHarness({
    isModelInUse: (kind, modelId) => kind === 'whisper' && modelId === 'Xenova/whisper-base',
  });
  try {
    const modelFile = path.join(h.userDataDir, 'whisper-models/Xenova/whisper-base/model.onnx');
    writeFile(modelFile, 13);
    assert.deepEqual(
      await h.service.deleteDownloadedModel('whisper', 'Xenova/whisper-base'),
      { success: false, error: 'model_in_use' },
    );
    assert.equal(fs.existsSync(modelFile), true);
  } finally {
    h.cleanup();
  }
});

test('a model that becomes active during size calculation is not deleted', async () => {
  let checks = 0;
  const h = makeHarness({
    isModelInUse: () => {
      checks += 1;
      return checks > 1;
    },
  });
  try {
    const modelFile = path.join(h.userDataDir, 'whisper-models/Xenova/whisper-base/model.onnx');
    writeFile(modelFile, 13);
    assert.deepEqual(
      await h.service.deleteDownloadedModel('whisper', 'Xenova/whisper-base'),
      { success: false, error: 'model_in_use' },
    );
    assert.equal(fs.existsSync(modelFile), true);
  } finally {
    h.cleanup();
  }
});

test('legacy data remains read-only until database and credentials migration is complete', async () => {
  const h = makeHarness();
  try {
    const legacyDir = path.join(h.appDataDir, 'Natively');
    writeFile(path.join(legacyDir, 'natively.db'), 29);
    writeFile(path.join(legacyDir, 'credentials.enc'), 31);
    writeFile(path.join(h.userDataDir, 'natively.db'), 37);

    const summary = await h.service.getStorageUsage();
    assert.equal(summary.legacyData.items[0].removable, false);
    assert.equal(summary.legacyData.items[0].reason, 'migration_incomplete');
    assert.deepEqual(
      await h.service.deleteLegacyData('natively'),
      { success: false, error: 'migration_incomplete' },
    );
    assert.equal(fs.existsSync(legacyDir), true);
  } finally {
    h.cleanup();
  }
});

test('copied-looking legacy data is not removable without an explicit migration marker', async () => {
  const h = makeHarness();
  try {
    const legacyDir = path.join(h.appDataDir, 'Natively');
    for (const entry of ['natively.db', 'credentials.enc']) {
      writeFile(path.join(legacyDir, entry), 11);
      writeFile(path.join(h.userDataDir, entry), 11);
    }

    const summary = await h.service.getStorageUsage();
    assert.equal(summary.legacyData.items[0].removable, false);
    assert.equal(summary.legacyData.items[0].reason, 'migration_incomplete');
  } finally {
    h.cleanup();
  }
});

test('deletion updates the next storage summary without touching protected user data', async () => {
  const h = makeHarness();
  try {
    const modelFile = path.join(h.userDataDir, 'sensevoice-models/sensevoice-small/model.onnx');
    writeFile(modelFile, 17);
    writeFile(path.join(h.userDataDir, 'natively.db'), 41);
    writeFile(path.join(h.userDataDir, 'credentials.enc'), 43);
    writeFile(path.join(h.userDataDir, 'knowledge-materials/document.pdf'), 47);

    const before = await h.service.getStorageUsage();
    assert.equal(before.downloadedModels.bytes, 17);
    assert.deepEqual(
      await h.service.deleteDownloadedModel('sensevoice', 'sensevoice-small'),
      { success: true, freedBytes: 17 },
    );
    const after = await h.service.getStorageUsage();
    assert.equal(after.downloadedModels.bytes, 0);
    assert.equal(fs.existsSync(path.join(h.userDataDir, 'natively.db')), true);
    assert.equal(fs.existsSync(path.join(h.userDataDir, 'credentials.enc')), true);
    assert.equal(fs.existsSync(path.join(h.userDataDir, 'knowledge-materials/document.pdf')), true);
  } finally {
    h.cleanup();
  }
});
