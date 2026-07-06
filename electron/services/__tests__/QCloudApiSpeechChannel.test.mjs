import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const restSttPath = path.resolve(root, 'dist-electron/electron/audio/RestSTT.js');
const clientPath = path.resolve(root, 'dist-electron/electron/audio/doubaoAucClient.js');

async function loadRestSTT() {
  return import(pathToFileURL(restSttPath).href);
}

async function loadClient() {
  return import(pathToFileURL(clientPath).href);
}

test('QCLOUD API speech channel uses Bearer auth and QCLOUD advanced AUC endpoints', async () => {
  const { RestSTT } = await loadRestSTT();
  const stt = new RestSTT('qcloud-stt', 'qcloud-test-key');

  assert.equal(stt.config.submitEndpoint.endsWith('/v1/doubao/audio/auc/submit'), true);
  assert.equal(stt.config.queryEndpoint.endsWith('/v1/doubao/audio/auc/query'), true);
  assert.deepEqual(stt.config.authHeader, { Authorization: 'Bearer qcloud-test-key' });
  assert.equal(stt.config.uploadType, 'auc-multipart');
  assert.equal(stt.config.authHeader['X-Api-Key'], undefined);
  assert.equal(stt.config.authHeader['X-Api-Resource-Id'], undefined);
});

test('QCLOUD API speech channel multipart form enables speaker, emotion, utterances, and ITN', async () => {
  const { RestSTT } = await loadRestSTT();
  const stt = new RestSTT('qcloud-stt', 'qcloud-test-key');
  const fields = stt.config.buildMultipartFields?.();

  assert.deepEqual(fields, {
    model: 'bigmodel',
    enable_speaker_info: 'true',
    enable_emotion_detection: 'true',
    show_utterances: 'true',
    enable_itn: 'true',
  });
});

test('QCLOUD API speech channel stays Chinese-first after explicit auto language update', async () => {
  const { RestSTT } = await loadRestSTT();
  const stt = new RestSTT('qcloud-stt', 'qcloud-test-key');
  stt.setRecognitionLanguage('auto');
  const fields = stt.config.buildMultipartFields?.();

  assert.equal(fields.enable_speaker_info, 'true');
  assert.equal(fields.language, undefined);
  assert.equal(fields.lang, undefined);
  assert.equal(fields.locale, undefined);
});

test('QCLOUD API speech channel uploads low-volume microphone audio instead of treating it as silence', async () => {
  const { RestSTT } = await loadRestSTT();
  const stt = new RestSTT('qcloud-stt', 'qcloud-test-key', undefined, undefined, {
    speaker: 'user',
  });
  const transcripts = [];
  const rawPcm = Buffer.alloc(8000);
  for (let offset = 0; offset < rawPcm.length; offset += 2) {
    rawPcm.writeInt16LE(20, offset);
  }

  stt.uploadAudio = async () => '低音量 QCLOUD 麦克风也应该上传';
  stt.on('transcript', event => transcripts.push(event));

  stt.start();
  stt.write(rawPcm);
  await stt.drainFinals(1000);
  stt.stop();

  assert.deepEqual(transcripts, [
    {
      text: '低音量 QCLOUD 麦克风也应该上传',
      isFinal: true,
      confidence: 1,
    },
  ]);
});

test('QCLOUD API speech channel is never shown as qcloud-stt in user-facing settings source', () => {
  const settings = fs.readFileSync(path.join(root, 'src/components/SettingsOverlay.tsx'), 'utf8');
  const speechOptionBlock = settings.match(/options=\{\[[\s\S]*?\]\}/)?.[0] || '';

  assert.match(speechOptionBlock, /label:\s*'QCLOUD API'/);
  assert.doesNotMatch(speechOptionBlock, /label:\s*['"]qcloud-stt['"]/i);
  assert.doesNotMatch(speechOptionBlock, /label:\s*['"]QCloudSTT['"]/);
});

test('QCLOUD API speaker separation settings label uses the active provider name', () => {
  const settings = fs.readFileSync(path.join(root, 'src/components/SettingsOverlay.tsx'), 'utf8');
  assert.match(settings, /speakerSeparationProviderLabel = sttProvider === 'qcloud-stt' \? 'QCLOUD API' : 'Doubao AUC'/);
  assert.match(settings, /Speaker separation on for \$\{speakerSeparationProviderLabel\}/);
  assert.doesNotMatch(settings, /Speaker separation on for Doubao AUC'/);
});

test('QCLOUD API missing saved key warning does not expose internal provider wording', () => {
  const settings = fs.readFileSync(path.join(root, 'src/components/SettingsOverlay.tsx'), 'utf8');

  assert.match(settings, /QCLOUD API key 未配置/);
  assert.doesNotMatch(settings, /qcloud-stt key 未配置/i);
});

test('QCLOUD API key presence does not remap other saved STT providers in settings', () => {
  const settings = fs.readFileSync(path.join(root, 'src/components/SettingsOverlay.tsx'), 'utf8');
  const start = settings.indexOf('const normalizeVisibleSttProvider =');
  const end = settings.indexOf('    // Close STT dropdown when clicking outside', start);
  assert.ok(start >= 0 && end > start, 'normalizeVisibleSttProvider block should exist');
  const block = settings.slice(start, end);

  assert.match(block, /provider === 'natively'[\s\S]*return hasQCloudKey \? 'qcloud-stt' : 'local-sensevoice'/);
  assert.match(block, /provider === 'groq'/);
  assert.match(block, /provider === 'openai'/);
  assert.doesNotMatch(block, /return hasQCloudKey \? 'qcloud-stt' : 'doubao-auc'/);
});

test('QCLOUD API new-api AUC helper submits multipart and polls task_id with JSON query', async () => {
  const { transcribeNewApiDoubaoAucMultipartFile } = await loadClient();
  const calls = [];
  const result = await transcribeNewApiDoubaoAucMultipartFile({
    submitEndpoint: 'https://example.test/v1/doubao/audio/auc/submit',
    queryEndpoint: 'https://example.test/v1/doubao/audio/auc/query',
    authHeader: { Authorization: 'Bearer qcloud-test-key' },
    audioBuffer: Buffer.from('wav'),
    filename: 'sample.wav',
    contentType: 'audio/wav',
    formFields: {
      model: 'bigmodel',
      enable_speaker_info: 'true',
      enable_emotion_detection: 'true',
      show_utterances: 'true',
      enable_itn: 'true',
    },
    extractTranscript: data => data?.result?.text || '',
    post: async (url, body, options) => {
      calls.push({ url, body, headers: options.headers });
      if (url.endsWith('/submit')) return { data: { task_id: 'task-1' }, headers: {} };
      assert.deepEqual(body, { task_id: 'task-1' });
      return { data: { status_code: '20000000', result: { text: '完成' } }, headers: {} };
    },
    pollIntervalMs: 0,
  });

  assert.equal(result, '完成');
  assert.equal(calls[0].url.endsWith('/submit'), true);
  assert.equal(typeof calls[0].body.getBoundary, 'function');
  assert.equal(calls[0].headers.Authorization, 'Bearer qcloud-test-key');
  assert.match(calls[0].headers['content-type'] || calls[0].headers['Content-Type'], /multipart\/form-data/);
  assert.deepEqual(calls[1].body, { task_id: 'task-1' });
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
});

test('QCLOUD API new-api AUC helper queries immediately before waiting between polls', async () => {
  const { transcribeNewApiDoubaoAucMultipartFile } = await loadClient();
  const startedAt = Date.now();
  const calls = [];
  const result = await transcribeNewApiDoubaoAucMultipartFile({
    submitEndpoint: 'https://example.test/v1/doubao/audio/auc/submit',
    queryEndpoint: 'https://example.test/v1/doubao/audio/auc/query',
    authHeader: { Authorization: 'Bearer qcloud-test-key' },
    audioBuffer: Buffer.from('wav'),
    filename: 'sample.wav',
    contentType: 'audio/wav',
    formFields: { model: 'bigmodel' },
    extractTranscript: data => data?.result?.text || '',
    post: async (url, body, options) => {
      calls.push({ url, body, headers: options.headers, elapsedMs: Date.now() - startedAt });
      if (url.endsWith('/submit')) return { data: { task_id: 'task-1' }, headers: {} };
      return { data: { status_code: '20000000', result: { text: '完成' } }, headers: {} };
    },
    pollIntervalMs: 2000,
  });

  assert.equal(result, '完成');
  assert.equal(calls.length, 2);
  assert.equal(calls[1].url.endsWith('/query'), true);
  assert.ok(calls[1].elapsedMs < 500, `first query should not wait for poll interval, got ${calls[1].elapsedMs}ms`);
});

test('IPC accepts QCLOUD API speech channel and tests it with the saved QCLOUD API key', () => {
  const ipc = fs.readFileSync(path.join(root, 'electron/ipcHandlers.ts'), 'utf8');

  assert.match(ipc, /\|\s*'qcloud-stt'/);
  assert.match(ipc, /provider === 'qcloud-stt'/);
  assert.match(ipc, /new FormData\(\)/);
  assert.match(ipc, /form\.append\('file'/);
  assert.match(ipc, /form\.append\('enable_speaker_info',\s*'true'\)/);
  assert.match(ipc, /form\.append\('enable_emotion_detection',\s*'true'\)/);
  assert.match(ipc, /form\.append\('show_utterances',\s*'true'\)/);
  assert.match(ipc, /Authorization:\s*`Bearer \$\{apiKey\.trim\(\)\}`/);
  assert.match(ipc, /QCLOUD_STT_SUBMIT_ENDPOINT/);
  assert.match(ipc, /if \(!response\.data\?\.task_id\)/);
  assert.match(ipc, /provider === 'qcloud-stt'\s*\? cm\.getNativelyApiKey\(\)/);
  assert.match(ipc, /provider === 'qcloud-stt'\s*\? QCLOUD_STT_SUBMIT_ENDPOINT/);
});

test('preload and renderer types include internal QCLOUD API speech channel id', () => {
  const preload = fs.readFileSync(path.join(root, 'electron/preload.ts'), 'utf8');
  const dts = fs.readFileSync(path.join(root, 'src/types/electron.d.ts'), 'utf8');

  assert.match(preload, /\|\s*'qcloud-stt'/);
  assert.match(dts, /\|\s*'qcloud-stt'/);
});
