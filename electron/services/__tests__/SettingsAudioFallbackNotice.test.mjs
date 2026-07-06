import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');

function read(relativePath) {
    return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('settings audio fallback banner distinguishes screen recording permission from output device open failure', () => {
    const settings = read('src/components/SettingsOverlay.tsx');

    assert.match(settings, /screenRecordingFallbackReasons/);
    assert.match(settings, /屏幕录制权限阻止了系统音频采集/);
    assert.match(settings, /screen-recording-permission-denied/);
    assert.match(settings, /screen-recording-stale-grant/);

    const banner = settings.slice(
        settings.indexOf('{deviceFallbackNotice && ('),
        settings.indexOf('localStorage.removeItem', settings.indexOf('{deviceFallbackNotice && (')),
    );
    const permissionTextIndex = banner.indexOf('屏幕录制权限阻止了系统音频采集');
    const genericOutputTextIndex = banner.indexOf("couldn't be opened");

    assert.ok(permissionTextIndex >= 0, 'permission-specific text should be present');
    assert.ok(genericOutputTextIndex >= 0, 'generic device-open fallback should remain for real device failures');
    assert.ok(permissionTextIndex < genericOutputTextIndex, 'permission reason should be handled before generic device failure copy');
    assert.match(banner, /isKnownScreenRecordingFallback/);
    assert.match(banner, /deviceFallbackNotice\.reason && !isKnownScreenRecordingFallback/);
});
