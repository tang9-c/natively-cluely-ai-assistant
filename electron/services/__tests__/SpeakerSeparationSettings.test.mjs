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

test('speaker separation setting is exposed through IPC, preload, and renderer types', () => {
    const ipc = read('electron/ipcHandlers.ts');
    const preload = read('electron/preload.ts');
    const types = read('src/types/electron.d.ts');

    assert.match(ipc, /get-speaker-separation-mode/);
    assert.match(ipc, /set-speaker-separation-mode/);
    assert.match(preload, /getSpeakerSeparationMode/);
    assert.match(preload, /setSpeakerSeparationMode/);
    assert.match(types, /getSpeakerSeparationMode: \(\) => Promise<'auto' \| 'off'>/);
    assert.match(types, /setSpeakerSeparationMode: \(mode: 'auto' \| 'off'\) => Promise<\{ success: boolean; error\?: string \}>/);
});

test('speaker separation control lives in the Audio speech provider settings', () => {
    const settings = read('src/components/SettingsOverlay.tsx');

    assert.match(settings, /Speaker separation/);
    assert.match(settings, /speakerSeparationMode/);
    assert.match(settings, /Speaker separation on for Doubao AUC/);
    assert.match(settings, /Speaker separation unavailable for this transcription provider/);
    assert.match(settings, /Speaker separation off/);

    const providerIndex = settings.indexOf('Speech Provider Section');
    const speakerIndex = settings.indexOf('>Speaker separation</label>');
    const languageIndex = settings.indexOf('Recognition Language Family');
    assert.ok(providerIndex >= 0, 'Speech Provider Section marker should exist');
    assert.ok(speakerIndex > providerIndex, 'Speaker separation belongs in Speech Provider section');
    assert.ok(speakerIndex < languageIndex, 'Speaker separation should appear before language controls');
});

test('Doubao AUC registry passes speaker separation mode and channel into RestSTT', () => {
    const registry = read('electron/audio/sttRegistry.ts');

    assert.match(registry, /getSpeakerSeparationMode/);
    assert.match(registry, /new RestSTT\('doubao-auc', key, undefined, undefined, \{ speaker, speakerSeparationMode/);
});

test('Doubao provider choices distinguish API capability without implying different API keys', () => {
    const settings = read('src/components/SettingsOverlay.tsx');

    assert.match(settings, /Doubao Streaming ASR/);
    assert.match(settings, /Same Doubao API key; streaming ASR, no speaker separation/);
    assert.match(settings, /Doubao AUC \(Speaker separation\)/);
    assert.match(settings, /Same Doubao API key; AUC BigModel with speaker separation/);
    assert.match(settings, /use Doubao AUC \(Speaker separation\) with the same key/);
});

test('transcript persistence preserves optional speaker diarization metadata', () => {
    const db = read('electron/db/DatabaseManager.ts');

    assert.match(db, /if\s*\(\s*version\s*<\s*24\s*\)/);
    assert.match(db, /user_version\s*=\s*24/);
    for (const column of [
        'speaker_id',
        'speaker_label',
        'provider_speaker_id',
        'diarization_provider',
        'start_timestamp_ms',
        'end_timestamp_ms',
    ]) {
        assert.match(db, new RegExp(column), `DatabaseManager should persist ${column}`);
    }
    assert.match(db, /segment\.speakerId/);
    assert.match(db, /segment\.speakerLabel/);
    assert.match(db, /row\.speaker_id/);
    assert.match(db, /row\.speaker_label/);
});
