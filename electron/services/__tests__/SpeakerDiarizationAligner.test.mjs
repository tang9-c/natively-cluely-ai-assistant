import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const alignerPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/SpeakerDiarizationAligner.js');

async function loadAligner() {
    return import(pathToFileURL(alignerPath).href);
}

test('SpeakerDiarizationAligner reuses a stable speaker when overlap maps changed provider ids', async () => {
    const { SpeakerDiarizationAligner } = await loadAligner();
    const aligner = new SpeakerDiarizationAligner('interviewer');

    const first = aligner.align({
        utterances: [
            { text: 'first turn', startMs: 0, endMs: 1800, providerSpeakerId: '1' },
        ],
        emitAfterMs: 0,
    });

    assert.deepEqual(first.map(item => [item.text, item.speakerId, item.speakerLabel]), [
        ['first turn', 'interviewer-1', 'Interviewer 1'],
    ]);

    const second = aligner.align({
        utterances: [
            { text: 'overlap repeat', startMs: 1600, endMs: 1900, providerSpeakerId: '7' },
            { text: 'new words', startMs: 2100, endMs: 2600, providerSpeakerId: '7' },
        ],
        emitAfterMs: 2000,
    });

    assert.deepEqual(second.map(item => [item.text, item.speakerId, item.speakerLabel]), [
        ['new words', 'interviewer-1', 'Interviewer 1'],
    ]);
});

test('SpeakerDiarizationAligner allocates a new speaker after a long gap without overlap evidence', async () => {
    const { SpeakerDiarizationAligner } = await loadAligner();
    const aligner = new SpeakerDiarizationAligner('interviewer');

    aligner.align({
        utterances: [
            { text: 'first turn', startMs: 0, endMs: 1000, providerSpeakerId: '1' },
        ],
        emitAfterMs: 0,
    });

    const next = aligner.align({
        utterances: [
            { text: 'later turn', startMs: 4000, endMs: 4800, providerSpeakerId: '2' },
        ],
        emitAfterMs: 3000,
    });

    assert.deepEqual(next.map(item => [item.text, item.speakerId, item.speakerLabel]), [
        ['later turn', 'interviewer-2', 'Interviewer 2'],
    ]);
});

test('SpeakerDiarizationAligner does not invent speaker labels without provider evidence', async () => {
    const { SpeakerDiarizationAligner } = await loadAligner();
    const aligner = new SpeakerDiarizationAligner('interviewer');

    const aligned = aligner.align({
        utterances: [
            { text: 'provider returned no speaker id', startMs: 0, endMs: 1000 },
        ],
        emitAfterMs: 0,
    });

    assert.equal(aligned.length, 1);
    assert.equal(aligned[0].providerSpeakerId, undefined);
    assert.equal(aligned[0].speakerId, undefined);
    assert.equal(aligned[0].speakerLabel, undefined);
});
