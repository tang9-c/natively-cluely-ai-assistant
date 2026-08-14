import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('src/components/NativelyInterface.tsx', 'utf8');

test('screenshot failures use structured permission health and one shared handler', () => {
  assert.match(
    source,
    /const handleScreenshotFailure = useCallback\(async \(error: unknown\)/,
  );
  assert.match(source, /await window\.electronAPI\.checkPermissions\(\)/);
  assert.match(
    source,
    /permissions\.platform === 'darwin'[\s\S]*?!permissions\.screenHealth\.effectiveGranted/,
  );
  assert.doesNotMatch(source, /includes\(['"]Screen Recording/);
  assert.equal(
    (source.match(/await handleScreenshotFailure\(err\)/g) || []).length,
    4,
    'full and selective screenshot handlers should share the same failure path',
  );
});

test('screen permission warning exposes settings and repair actions', () => {
  assert.match(source, /kind: 'screenshot-capture-failure'/);
  assert.match(
    source,
    /systemAudioWarning\.kind === 'screen-recording-permission'[\s\S]*?打开设置[\s\S]*?handleRepairTccPermission[\s\S]*?修复权限并重启/,
  );
  assert.match(
    source,
    /systemAudioWarning\.kind === 'screenshot-capture-failure'[\s\S]*?截图失败/,
  );
});
