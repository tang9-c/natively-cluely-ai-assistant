import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const moduleUrl = pathToFileURL(
  path.resolve('dist-electron/electron/db/sqliteVecExtensionPath.js'),
).href;

test('官方路径映射到 app.asar.unpacked 并移除动态库后缀', async () => {
  const { resolveSqliteVecExtensionPath } = await import(moduleUrl);
  const expectedFile = '/Applications/CueUp.app/Contents/Resources/app.asar.unpacked/node_modules/sqlite-vec-darwin-arm64/vec0.dylib';
  const result = resolveSqliteVecExtensionPath({
    getLoadablePath: () => expectedFile.replace('app.asar.unpacked', 'app.asar'),
    requireResolve: () => { throw new Error('not used'); },
    existsSync: (candidate) => candidate === expectedFile,
    platform: 'darwin',
    arch: 'arm64',
  });
  assert.equal(result, expectedFile.replace(/\.dylib$/, ''));
});

test('包导出错误时从 sqlite-vec 同级平台包解析 Intel dylib', async () => {
  const { resolveSqliteVecExtensionPath } = await import(moduleUrl);
  const expectedFile = '/app/Resources/app.asar.unpacked/node_modules/sqlite-vec-darwin-x64/vec0.dylib';
  const result = resolveSqliteVecExtensionPath({
    getLoadablePath: () => { throw Object.assign(new Error('not exported'), { code: 'ERR_PACKAGE_PATH_NOT_EXPORTED' }); },
    requireResolve: () => '/app/Resources/app.asar/node_modules/sqlite-vec/index.cjs',
    existsSync: (candidate) => candidate === expectedFile,
    platform: 'darwin',
    arch: 'x64',
  });
  assert.equal(result, expectedFile.replace(/\.dylib$/, ''));
});

test('目标平台动态库不存在时返回明确错误', async () => {
  const { resolveSqliteVecExtensionPath } = await import(moduleUrl);
  assert.throws(() => resolveSqliteVecExtensionPath({
    getLoadablePath: () => { throw new Error('resolve failed'); },
    requireResolve: () => '/app/node_modules/sqlite-vec/index.cjs',
    existsSync: () => false,
    platform: 'win32',
    arch: 'x64',
  }), /sqlite-vec extension not found for win32\/x64/);
});
