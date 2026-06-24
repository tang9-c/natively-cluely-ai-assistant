import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const repoRoot = process.cwd();

function readRepoFile(...segments) {
  return readFileSync(join(repoRoot, ...segments), 'utf8');
}

test('Windows x64 workflow builds and uploads a Windows x64 distributable', () => {
  const workflow = readRepoFile('.github', 'workflows', 'build-windows-x64.yml');

  assert.match(workflow, /^name:\s*Build Windows x64$/m);
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.match(workflow, /^\s*runs-on:\s*windows-latest$/m);
  assert.match(workflow, /^\s*node-version:\s*22$/m);
  assert.match(workflow, /^\s*run:\s*npm install$/m);

  for (const command of [
    'npm run build',
    'npm run build:electron',
    'npm run build:native',
    'npx electron-builder --win --x64 --publish never',
  ]) {
    assert.ok(workflow.includes(command), `Expected workflow to include: ${command}`);
  }

  for (const artifactPath of [
    'release/*.exe',
    'release/*.blockmap',
    'release/latest.yml',
  ]) {
    assert.ok(workflow.includes(artifactPath), `Expected workflow to upload: ${artifactPath}`);
  }
});

test('native build script verifies the Windows x64 napi artifact', () => {
  const buildNativeScript = readRepoFile('scripts', 'build-native.js');

  assert.ok(
    buildNativeScript.includes("x64: ['index.win32-x64-msvc.node']"),
    'Expected build:native to verify the Windows x64 native module artifact'
  );
});
