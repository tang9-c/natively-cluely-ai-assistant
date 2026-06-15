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
