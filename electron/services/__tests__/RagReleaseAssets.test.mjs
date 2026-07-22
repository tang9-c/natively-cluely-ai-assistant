import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

test('当前 macOS ARM64 工作区包含全部 RAG 发布资产', () => {
  const { validateRagReleaseAssets } = require('../../../scripts/verify-rag-release-assets.js');
  const errors = validateRagReleaseAssets({
    rootDir: path.resolve('.'),
    platform: 'darwin',
    arch: 'arm64',
  });
  assert.deepEqual(errors, []);
});

test('缺失内置 ONNX 模型时校验失败并只报告相对资产名', () => {
  const { validateRagReleaseAssets } = require('../../../scripts/verify-rag-release-assets.js');
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cueup-rag-assets-'));
  const errors = validateRagReleaseAssets({ rootDir, platform: 'win32', arch: 'x64' });
  assert.ok(errors.includes('resources/models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/onnx/model_int8.onnx'));
  assert.equal(JSON.stringify(errors).includes(rootDir), false);
});
