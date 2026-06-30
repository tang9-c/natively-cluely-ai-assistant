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

test('settings exposes only implemented Doubao AUC provider for speaker separation', () => {
    const settings = read('src/components/SettingsOverlay.tsx');

    assert.match(settings, /Doubao AUC \(Speaker separation\)/);
    assert.match(settings, /Same Doubao API key; AUC BigModel with speaker separation/);
    assert.doesNotMatch(settings, /Doubao Streaming ASR/);
    assert.doesNotMatch(settings, /id: 'doubao', label:/);
});

test('settings hides advanced STT providers from the provider dropdown', () => {
    const settings = read('src/components/SettingsOverlay.tsx');
    const hiddenProviderLabels = [
        'Google Cloud',
        'Groq Whisper',
        'OpenAI Whisper',
        'Deepgram Nova-3',
        'ElevenLabs Scribe',
        'Azure Speech',
        'IBM Watson',
        'Soniox',
        'Local Whisper',
    ];

    for (const label of hiddenProviderLabels) {
        assert.doesNotMatch(settings, new RegExp(`label: '${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`));
    }
});

test('legacy Doubao STT provider is normalized to Doubao AUC', () => {
    const credentials = read('electron/services/CredentialsManager.ts');

    assert.match(credentials, /provider === 'doubao'/);
    assert.match(credentials, /sttProvider = 'doubao-auc'/);
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

test('local speaker verification does not replace Doubao AUC provider diarization', () => {
    const base = read('electron/audio/BaseSTT.ts');
    const rest = read('electron/audio/RestSTT.ts');

    assert.match(base, /speakerVerification/);
    assert.match(rest, /diarizationProvider: 'doubao-auc'/);
    assert.match(rest, /speakerVerification/);
    assert.doesNotMatch(rest, /diarizationProvider: 'local-speaker-verification'/);
});
