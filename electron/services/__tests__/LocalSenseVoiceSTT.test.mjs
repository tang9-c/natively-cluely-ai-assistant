import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/LocalSenseVoiceSTT.js');

async function loadLocalSenseVoiceSTT() {
  return import(pathToFileURL(modulePath).href);
}

function loudPcm(bytes = 12000) {
  const buffer = Buffer.alloc(bytes);
  for (let offset = 0; offset < buffer.length; offset += 2) {
    buffer.writeInt16LE(1200, offset);
  }
  return buffer;
}

class FakeSenseVoiceWorker extends EventEmitter {
  constructor({ text = '你好，欢迎参加会议。', delayMs = 0 } = {}) {
    super();
    this.text = text;
    this.delayMs = delayMs;
    this.messages = [];
    queueMicrotask(() => this.emit('message', { type: 'ready' }));
  }

  postMessage(message) {
    this.messages.push(message);
    if (message.type !== 'transcribe') return;
    setTimeout(() => {
      this.emit('message', {
        type: 'result',
        taskId: message.taskId,
        text: this.text,
      });
    }, this.delayMs);
  }

  terminate() {
    this.emit('exit', 0);
    return Promise.resolve(0);
  }
}

test('LocalSenseVoiceSTT emits a final transcript from a completed segment', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const worker = new FakeSenseVoiceWorker();
  const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
  const transcripts = [];
  stt.on('transcript', event => transcripts.push(event));

  stt.start();
  stt.write(loudPcm());
  stt.notifySpeechEnded();
  await stt.drainFinals(1000);
  stt.stop();

  assert.deepEqual(transcripts, [
    {
      text: '你好，欢迎参加会议。',
      isFinal: true,
      confidence: 0.9,
    },
  ]);
  assert.equal(worker.messages.some(message => message.type === 'transcribe'), true);
});

test('LocalSenseVoiceSTT drainFinals waits for in-flight recognition', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const worker = new FakeSenseVoiceWorker({ text: '最终中文转写。', delayMs: 100 });
  const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
  const transcripts = [];
  stt.on('transcript', event => transcripts.push(event));

  stt.start();
  stt.write(loudPcm());
  stt.notifySpeechEnded();
  const startedAt = Date.now();
  await stt.drainFinals(1000);
  const elapsedMs = Date.now() - startedAt;
  stt.stop();

  assert.ok(elapsedMs >= 90);
  assert.equal(transcripts[0]?.text, '最终中文转写。');
});

test('LocalSenseVoiceSTT emits SenseVoice emotion metadata without polluting transcript text', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const worker = new FakeSenseVoiceWorker({ text: '<|zh|><|ANGRY|><|Speech|>这个不对。' });
  const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
  const transcripts = [];
  stt.on('transcript', event => transcripts.push(event));

  stt.start();
  stt.write(loudPcm());
  stt.notifySpeechEnded();
  await stt.drainFinals(1000);
  stt.stop();

  assert.deepEqual(transcripts, [
    {
      text: '这个不对。',
      isFinal: true,
      confidence: 0.9,
      emotion: 'angry',
      emotionSource: 'sensevoice',
    },
  ]);
});

test('LocalSenseVoiceSTT applies final term correction while preserving SenseVoice metadata', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const worker = new FakeSenseVoiceWorker({ text: '<|zh|><|HAPPY|><|Speech|>内提夫利很好用。' });
  const stt = new LocalSenseVoiceSTT({
    workerFactory: () => worker,
    termCorrection: {
      enabled: true,
      terms: [{ id: '1', canonical: 'Natively', variants: ['内提夫利'], enabled: true }],
    },
  });
  const transcripts = [];
  stt.on('transcript', event => transcripts.push(event));

  stt.start();
  stt.write(loudPcm());
  stt.notifySpeechEnded();
  await stt.drainFinals(1000);
  stt.stop();

  assert.deepEqual(transcripts, [
    {
      text: 'Natively很好用。',
      isFinal: true,
      confidence: 0.9,
      emotion: 'happy',
      emotionSource: 'sensevoice',
    },
  ]);
});
