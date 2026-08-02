import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { describe, test } from 'node:test';
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
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

test('LocalSenseVoiceSTT drainFinals waits for bounded speaker annotation before transcript emission', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const { SpeakerVerificationAnnotator } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js')).href);
  const worker = new FakeSenseVoiceWorker({ text: '这是我的发言。' });
  const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
  const transcripts = [];
  stt.setSpeakerVerificationAnnotator(new SpeakerVerificationAnnotator({
    getMode: () => 'local',
    timeoutMs: 200,
    service: {
      verify: async () => {
        await sleep(120);
        return {
          status: 'verified',
          speakerVerification: {
            provider: 'local-speaker-verification',
            profileId: 'me',
            isMe: true,
            confidence: 0.93,
            threshold: 0.72,
          },
        };
      },
    },
  }));
  stt.on('transcript', event => transcripts.push(event));

  stt.start();
  stt.write(loudPcm(16000 * 2 * 2));
  stt.notifySpeechEnded();
  const startedAt = Date.now();
  await stt.drainFinals(1000);
  const elapsedMs = Date.now() - startedAt;
  stt.stop();

  assert.ok(elapsedMs >= 110);
  assert.equal(transcripts.length, 1);
  assert.equal(transcripts[0].speakerVerification?.isMe, true);
});

test('LocalSenseVoiceSTT emits transcript when speaker verification service hangs', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const { SpeakerVerificationAnnotator } = await import(pathToFileURL(path.resolve(__dirname, '../../../dist-electron/electron/services/speaker/SpeakerVerificationAnnotator.js')).href);
  const worker = new FakeSenseVoiceWorker({ text: '验证服务超时不应阻塞。' });
  const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
  const transcripts = [];
  stt.setSpeakerVerificationAnnotator(new SpeakerVerificationAnnotator({
    getMode: () => 'local',
    timeoutMs: 20,
    service: { verify: () => new Promise(() => {}) },
  }));
  stt.on('transcript', event => transcripts.push(event));

  stt.start();
  stt.write(loudPcm());
  stt.notifySpeechEnded();
  await stt.drainFinals(1000);
  stt.stop();

  assert.deepEqual(transcripts, [{ text: '验证服务超时不应阻塞。', isFinal: true, confidence: 0.9 }]);
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

test('LocalSenseVoiceSTT suppresses short SenseVoice language-drift hallucinations', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const cases = [
    '<|en|><|NEUTRAL|><|Speech|>There.',
    '<|ja|><|NEUTRAL|><|Speech|>といでね。',
  ];

  for (const text of cases) {
    const worker = new FakeSenseVoiceWorker({ text });
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
    const transcripts = [];
    stt.on('transcript', event => transcripts.push(event));

    stt.setRecognitionLanguage('chinese');
    stt.start();
    stt.write(loudPcm());
    stt.notifySpeechEnded();
    await stt.drainFinals(1000);
    stt.stop();

    assert.deepEqual(transcripts, []);
  }
});

test('LocalSenseVoiceSTT keeps normal Chinese and mixed business transcript text', async () => {
  const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
  const worker = new FakeSenseVoiceWorker({ text: '<|zh|><|NEUTRAL|><|Speech|>我们讨论 API、SSO 和 PLM 集成。' });
  const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
  const transcripts = [];
  stt.on('transcript', event => transcripts.push(event));

  stt.setRecognitionLanguage('chinese');
  stt.start();
  stt.write(loudPcm());
  stt.notifySpeechEnded();
  await stt.drainFinals(1000);
  stt.stop();

  assert.deepEqual(transcripts, [
    {
      text: '我们讨论 API、SSO 和 PLM 集成。',
      isFinal: true,
      confidence: 0.9,
    },
  ]);
});

describe('LocalSenseVoiceSTT — VAD flush timing', () => {
  test('notifySpeechEnded debounce is cancelled when audio continues', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const worker = new FakeSenseVoiceWorker();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });

    stt.start();
    stt.write(loudPcm());
    stt.notifySpeechEnded();
    await sleep(200);
    stt.write(loudPcm());
    await sleep(850);

    assert.equal(worker.messages.some(message => message.type === 'transcribe'), false);
    stt.stop();
  });

  test('notifySpeechEnded debounce flushes VAD when no audio resumes', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const worker = new FakeSenseVoiceWorker();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });

    stt.start();
    stt.write(loudPcm());
    stt.notifySpeechEnded();
    await sleep(900);

    assert.equal(worker.messages.some(message => message.type === 'transcribe'), true);
    stt.stop();
  });

  test('finalize flushes VAD immediately without waiting for debounce', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const worker = new FakeSenseVoiceWorker();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });

    stt.start();
    stt.write(loudPcm());
    stt.notifySpeechEnded();
    stt.finalize();
    await sleep(20);

    assert.equal(worker.messages.some(message => message.type === 'transcribe'), true);
    stt.stop();
  });
});

describe('LocalSenseVoiceSTT — lifecycle guards', () => {
  test('start() is idempotent: a second call does not spawn a second worker', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    let spawnCount = 0;
    const makeWorker = () => {
      spawnCount++;
      return new FakeSenseVoiceWorker();
    };
    const stt = new LocalSenseVoiceSTT({ workerFactory: makeWorker });
    stt.start();
    stt.start();
    assert.equal(spawnCount, 1);
    stt.stop();
  });

  test('stop() is a no-op when the STT is not active', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => new FakeSenseVoiceWorker() });
    // Never started — must not throw and must not invoke the worker factory.
    assert.doesNotThrow(() => stt.stop());
  });

  test('write() before start() is silently dropped (no VAD, no transcribe)', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const worker = new FakeSenseVoiceWorker();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
    const transcripts = [];
    stt.on('transcript', e => transcripts.push(e));
    stt.write(loudPcm());
    // No transcribe posted, no transcript emitted.
    assert.equal(worker.messages.some(message => message.type === 'transcribe'), false);
    assert.equal(transcripts.length, 0);
  });

  test('notifySpeechEnded before start() does not throw', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => new FakeSenseVoiceWorker() });
    assert.doesNotThrow(() => stt.notifySpeechEnded());
    assert.doesNotThrow(() => stt.finalize());
  });

  test('drainFinals returns immediately when no audio is pending', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => new FakeSenseVoiceWorker() });
    stt.start();
    // No write/notify — pendingAudio is empty and inFlightTasks is 0.
    const startedAt = Date.now();
    await stt.drainFinals(2000);
    const elapsedMs = Date.now() - startedAt;
    assert.ok(elapsedMs < 100, `expected fast path, took ${elapsedMs}ms`);
    stt.stop();
  });
});

describe('LocalSenseVoiceSTT — configuration setters', () => {
  test('setRecognitionLanguage("") falls back to "chinese"', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => new FakeSenseVoiceWorker() });
    stt.setRecognitionLanguage('');
    assert.equal(stt._languageKey, 'chinese');
    stt.setRecognitionLanguage('english-us');
    assert.equal(stt._languageKey, 'english-us');
  });

  test('setChannel trims whitespace and accepts nullish values', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => new FakeSenseVoiceWorker() });
    stt.setChannel('  system  ');
    assert.equal(stt.channelLabel, 'system');
    stt.setChannel('');
    assert.equal(stt.channelLabel, '');
    stt.setChannel(null);
    assert.equal(stt.channelLabel, '');
  });
});

describe('LocalSenseVoiceSTT — worker error handling', () => {
  test('worker "error" event clears pendingAudio and re-emits the error', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    // Use a silent worker that never resolves tasks so inFlight stays > 0.
    const worker = new FakeSenseVoiceWorker({ text: '', delayMs: 60_000 });
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
    const errors = [];
    stt.on('error', err => errors.push(err));
    stt.start();
    // Push enough loud audio to emit at least one VAD segment.
    for (let i = 0; i < 5; i++) stt.write(loudPcm());
    stt.finalize();
    // Wait one tick so dispatchFinal has run, then another so the FakeWorker
    // postMessage setTimeout can't drain pendingAudio.
    await new Promise(r => setImmediate(r));
    await new Promise(r => setImmediate(r));
    const before = stt.pendingAudio.length + stt.inFlightTasks;
    assert.ok(before > 0, `expected pendingAudio+inFlightTasks > 0, got ${before}`);
    const boom = new Error('worker exploded');
    worker.emit('error', boom);
    assert.equal(stt.pendingAudio.length, 0);
    assert.equal(stt.inFlightTasks, 0);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].message, 'worker exploded');
    stt.stop();
  });

  test('worker non-zero exit while active emits a descriptive error', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const worker = new FakeSenseVoiceWorker();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
    const errors = [];
    stt.on('error', err => errors.push(err));
    stt.start();
    worker.emit('exit', 137);
    assert.equal(errors.length, 1);
    assert.match(errors[0].message, /exited with code 137/);
    stt.stop();
  });

  test('worker non-zero exit while inactive is suppressed', async () => {
    const { LocalSenseVoiceSTT } = await loadLocalSenseVoiceSTT();
    const worker = new FakeSenseVoiceWorker();
    const stt = new LocalSenseVoiceSTT({ workerFactory: () => worker });
    const errors = [];
    stt.on('error', err => errors.push(err));
    stt.start();
    stt.stop();
    worker.emit('exit', 1);
    assert.equal(errors.length, 0);
  });
});
