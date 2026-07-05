import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/doubaoAucClient.js');
const restSttPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/RestSTT.js');

const authHeader = {
    'X-Api-Key': 'test-api-key',
    'X-Api-Resource-Id': 'volc.seedasr.auc',
};

async function loadClient() {
    return import(pathToFileURL(clientPath).href);
}

async function loadRestSTT() {
    return import(pathToFileURL(restSttPath).href);
}

function createOptions(overrides) {
    return {
        submitEndpoint: 'https://example.test/api/v3/auc/bigmodel/submit',
        queryEndpoint: 'https://example.test/api/v3/auc/bigmodel/query',
        authHeader,
        requestBody: { audio: { data: 'base64-wav' } },
        requestId: 'req-123',
        pollIntervalMs: 0,
        maxAttempts: 3,
        logger: { log() {} },
        ...overrides,
    };
}

test('Doubao AUC queries with the submit request id when submit body is empty', async () => {
    const { transcribeDoubaoAucFile, extractDoubaoAucTranscript } = await loadClient();
    const calls = [];
    const post = async (url, body, options) => {
        calls.push({ url, body, options });
        if (url.endsWith('/submit')) {
            return {
                data: {},
                headers: {
                    'x-api-status-code': '20000000',
                    'x-tt-logid': 'log-1',
                },
            };
        }
        return {
            data: { result: { text: '你好，欢迎参加会议。' } },
            headers: { 'x-api-status-code': '20000000' },
        };
    };

    const text = await transcribeDoubaoAucFile(createOptions({
        extractTranscript: extractDoubaoAucTranscript,
        post,
    }));

    assert.equal(text, '你好，欢迎参加会议。');
    assert.equal(calls.length, 2);
    assert.equal(calls[0].options.headers['X-Api-Request-Id'], 'req-123');
    assert.equal(calls[1].options.headers['X-Api-Request-Id'], 'req-123');
    assert.equal(calls[1].options.headers['X-Tt-Logid'], 'log-1');
});

test('Doubao AUC structured extraction keeps polling when submit body has no transcript', async () => {
    const {
        transcribeDoubaoAucFile,
        extractDoubaoAucTranscriptionJson,
    } = await loadClient();
    const calls = [];
    const post = async (url, body, options) => {
        calls.push({ url, body, options });
        if (url.endsWith('/submit')) {
            return {
                data: {},
                headers: {
                    'x-api-status-code': '20000000',
                    'x-tt-logid': 'log-structured',
                },
            };
        }
        return {
            data: {
                result: {
                    utterances: [
                        { text: '结构化结果到了', start_time: 0, end_time: 1200, speaker_id: '1' },
                    ],
                },
            },
            headers: { 'x-api-status-code': '20000000' },
        };
    };

    assert.equal(typeof extractDoubaoAucTranscriptionJson, 'function');

    const jsonText = await transcribeDoubaoAucFile(createOptions({
        extractTranscript: extractDoubaoAucTranscriptionJson,
        post,
    }));

    assert.equal(calls.length, 2);
    assert.equal(calls[1].url, 'https://example.test/api/v3/auc/bigmodel/query');
    assert.equal(calls[1].options.headers['X-Tt-Logid'], 'log-structured');
    assert.deepEqual(JSON.parse(jsonText), {
        text: '结构化结果到了',
        utterances: [
            {
                text: '结构化结果到了',
                startMs: 0,
                endMs: 1200,
                providerSpeakerId: '1',
            },
        ],
    });
});

test('Doubao AUC keeps polling through pending status and joins utterances', async () => {
    const { transcribeDoubaoAucFile, extractDoubaoAucTranscript } = await loadClient();
    const calls = [];
    let queryCount = 0;
    const post = async (url, body, options) => {
        calls.push({ url, body, options });
        if (url.endsWith('/submit')) {
            return {
                data: {},
                headers: { 'x-api-status-code': '20000000' },
            };
        }
        queryCount += 1;
        if (queryCount === 1) {
            return {
                data: {},
                headers: { 'x-api-status-code': '20000001' },
            };
        }
        return {
            data: {
                result: {
                    utterances: [
                        { text: '第一句' },
                        { text: '第二句' },
                    ],
                },
            },
            headers: { 'x-api-status-code': '20000000' },
        };
    };

    const text = await transcribeDoubaoAucFile(createOptions({
        extractTranscript: extractDoubaoAucTranscript,
        post,
    }));

    assert.equal(text, '第一句 第二句');
    assert.equal(calls.length, 3);
});

test('Doubao AUC extracts structured utterances with provider speaker ids', async () => {
    const { extractDoubaoAucTranscription } = await loadClient();

    const result = extractDoubaoAucTranscription({
        result: {
            text: '你好。我们看预算。',
            utterances: [
                { text: '你好。', start_time: 0, end_time: 900, speaker_id: '1' },
                { text: '我们看预算。', start_time: 1100, end_time: 2400, additions: { speaker: '2' } },
            ],
        },
    });

    assert.deepEqual(result, {
        text: '你好。我们看预算。',
        utterances: [
            { text: '你好。', startMs: 0, endMs: 900, providerSpeakerId: '1' },
            { text: '我们看预算。', startMs: 1100, endMs: 2400, providerSpeakerId: '2' },
        ],
    });
});

test('Doubao AUC structured extraction preserves optional QCLOUD emotion metadata', async () => {
    const { extractDoubaoAucTranscription } = await loadClient();

    const result = extractDoubaoAucTranscription({
        result: {
            utterances: [
                {
                    text: '我们需要看客户案例。',
                    start_time: 0,
                    end_time: 900,
                    additions: {
                        speaker: '1',
                        emotion: 'neutral',
                        emotion_degree: 'weak',
                        emotion_score: '0.9978123903274536',
                        emotion_degree_score: '0.9997349381446838',
                    },
                },
            ],
        },
    });

    assert.deepEqual(result.utterances[0], {
        text: '我们需要看客户案例。',
        startMs: 0,
        endMs: 900,
        providerSpeakerId: '1',
        emotion: 'neutral',
        emotionDegree: 'weak',
        emotionScore: 0.9978123903274536,
        emotionDegreeScore: 0.9997349381446838,
    });
});

test('Doubao AUC returns empty text for silent status without throwing', async () => {
    const { transcribeDoubaoAucFile, extractDoubaoAucTranscript } = await loadClient();
    const post = async (url) => {
        if (url.endsWith('/submit')) {
            return {
                data: {},
                headers: { 'x-api-status-code': '20000000' },
            };
        }
        return {
            data: {},
            headers: { 'x-api-status-code': '20000003' },
        };
    };

    const text = await transcribeDoubaoAucFile(createOptions({
        extractTranscript: extractDoubaoAucTranscript,
        post,
    }));

    assert.equal(text, '');
});

test('Doubao AUC throws when submit status is not successful', async () => {
    const { transcribeDoubaoAucFile, extractDoubaoAucTranscript } = await loadClient();
    const post = async () => ({
        data: {},
        headers: {
            'x-api-status-code': '40000000',
            'x-api-message': 'bad request',
        },
    });

    await assert.rejects(
        () => transcribeDoubaoAucFile(createOptions({
            extractTranscript: extractDoubaoAucTranscript,
            post,
        })),
        /Doubao AUC submit failed.*40000000.*bad request/
    );
});

test('RestSTT drainFinals waits for an in-flight file upload to emit final transcript', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('doubao-auc', 'test-api-key');
    const transcripts = [];
    const rawPcm = Buffer.alloc(8000);
    for (let offset = 0; offset < rawPcm.length; offset += 2) {
        rawPcm.writeInt16LE(1000, offset);
    }

    stt.uploadAudio = async () => {
        await new Promise(resolve => setTimeout(resolve, 100));
        return '最终转写文本';
    };
    stt.on('transcript', event => transcripts.push(event));

    stt.start();
    stt.write(rawPcm);

    const startedAt = Date.now();
    await stt.drainFinals(1000);
    const elapsedMs = Date.now() - startedAt;
    stt.stop();

    assert.ok(elapsedMs >= 90);
    assert.deepEqual(transcripts, [
        {
            text: '最终转写文本',
            isFinal: true,
            confidence: 1,
        },
    ]);
});

test('RestSTT logs when final flush has too little buffered audio to upload', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('doubao-auc', 'test-api-key');
    const logs = [];
    const originalLog = console.log;

    try {
        console.log = (...args) => {
            logs.push(args.map(String).join(' '));
        };

        const rawPcm = Buffer.alloc(1000);
        for (let offset = 0; offset < rawPcm.length; offset += 2) {
            rawPcm.writeInt16LE(1000, offset);
        }

        stt.start();
        stt.write(rawPcm);
        stt.finalize();
    } finally {
        console.log = originalLog;
        stt.stop();
    }

    assert.ok(
        logs.some(line => line.includes('Flush skipped') && line.includes('below-min-buffer')),
        'Doubao AUC should explain when no REST upload happened because the final buffer was too small',
    );
});

test('RestSTT silent-buffer diagnostics include speaker and audio levels', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('doubao-auc', 'test-api-key', undefined, undefined, {
        speaker: 'user',
    });
    const logs = [];
    const originalLog = console.log;

    try {
        console.log = (...args) => {
            logs.push(args);
        };

        stt.start();
        stt.write(Buffer.alloc(8000));
        stt.finalize();
    } finally {
        console.log = originalLog;
        stt.stop();
    }

    const silentLog = logs.find((args) => String(args[0]).includes('Skipping silent buffer'));
    assert.ok(silentLog, 'silent buffer skip should be logged');
    assert.equal(silentLog[1]?.provider, 'doubao-auc');
    assert.equal(silentLog[1]?.speaker, 'user');
    assert.equal(silentLog[1]?.rms, 0);
    assert.equal(silentLog[1]?.peak, 0);
    assert.equal(silentLog[1]?.sampleRate, 16000);
    assert.equal(silentLog[1]?.channels, 1);
});

test('RestSTT uploads low-volume Doubao AUC microphone audio instead of treating it as silence', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('doubao-auc', 'test-api-key', undefined, undefined, {
        speaker: 'user',
    });
    const transcripts = [];
    const rawPcm = Buffer.alloc(8000);
    for (let offset = 0; offset < rawPcm.length; offset += 2) {
        rawPcm.writeInt16LE(20, offset);
    }

    stt.uploadAudio = async () => '低音量也应该上传';
    stt.on('transcript', event => transcripts.push(event));

    stt.start();
    stt.write(rawPcm);
    await stt.drainFinals(1000);
    stt.stop();

    assert.deepEqual(transcripts, [
        {
            text: '低音量也应该上传',
            isFinal: true,
            confidence: 1,
        },
    ]);
});

test('RestSTT Doubao AUC auto mode enables speaker separation for supported language', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('doubao-auc', 'test-api-key');
    stt.setRecognitionLanguage('auto');

    const requestBody = stt.config.buildRequestBody(Buffer.from('wav').toString('base64'), 'audio/wav');

    assert.equal(requestBody.request.enable_speaker_info, true);
    assert.equal(requestBody.request.ssd_version, '200');
    assert.equal(requestBody.request.show_utterances, true);
});

test('RestSTT Doubao AUC off mode disables speaker separation', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('doubao-auc', 'test-api-key', undefined, undefined, {
        speakerSeparationMode: 'off',
    });

    const requestBody = stt.config.buildRequestBody(Buffer.from('wav').toString('base64'), 'audio/wav');

    assert.equal(requestBody.request.enable_speaker_info, false);
    assert.equal(Object.hasOwn(requestBody.request, 'ssd_version'), false);
});

test('RestSTT emits structured Doubao AUC utterances with stable speaker metadata', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('doubao-auc', 'test-api-key');
    const transcripts = [];
    const rawPcm = Buffer.alloc(8000);
    for (let offset = 0; offset < rawPcm.length; offset += 2) {
        rawPcm.writeInt16LE(1000, offset);
    }

    stt.uploadAudio = async () => ({
        text: '你好。我们看预算。',
        utterances: [
            { text: '你好。', startMs: 0, endMs: 900, providerSpeakerId: '1' },
            { text: '我们看预算。', startMs: 1100, endMs: 2400, providerSpeakerId: '2' },
        ],
    });
    stt.on('transcript', event => transcripts.push(event));

    stt.start();
    stt.write(rawPcm);
    await stt.drainFinals(1000);
    stt.stop();

    assert.deepEqual(transcripts, [
        {
            text: '你好。',
            isFinal: true,
            confidence: 1,
            speakerId: 'interviewer-1',
            speakerLabel: 'Interviewer 1',
            providerSpeakerId: '1',
            diarizationProvider: 'doubao-auc',
            startTimestampMs: 0,
            endTimestampMs: 900,
        },
        {
            text: '我们看预算。',
            isFinal: true,
            confidence: 1,
            speakerId: 'interviewer-2',
            speakerLabel: 'Interviewer 2',
            providerSpeakerId: '2',
            diarizationProvider: 'doubao-auc',
            startTimestampMs: 1100,
            endTimestampMs: 2400,
        },
    ]);
});
