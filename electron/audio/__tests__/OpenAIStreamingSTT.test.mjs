// Unit tests for OpenAIStreamingSTT.
//
// The class has two transport modes:
//   * ws   — WebSocket Realtime API (the default; hard to fake without a server)
//   * rest — fallback to the OpenAI /audio/transcriptions REST endpoint
//
// We exercise the rest path (chosen via `baseUrl` parameter) and the lifecycle /
// configuration setters that do not depend on either transport. The ws path is
// covered structurally by the constructor + mode selection logic and is not
// feasible to mock without injecting a fake `ws` module.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/OpenAIStreamingSTT.js');

let originalLog;
let originalWarn;
let originalError;
async function loadOpenAIStreamingSTT() {
  return import(pathToFileURL(modulePath).href + `?t=${Date.now()}`);
}

beforeEach(() => {
  originalLog = console.log;
  originalWarn = console.warn;
  originalError = console.error;
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
});

afterEach(() => {
  console.log = originalLog;
  console.warn = originalWarn;
  console.error = originalError;
});

function loudPcm16le(samples = 1024, amplitude = 1200) {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(amplitude, i * 2);
  }
  return buf;
}

describe('OpenAIStreamingSTT — construction', () => {
  test('uses ws mode for the default OpenAI endpoint', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('sk-test');
    assert.equal(stt.apiKey, 'sk-test');
    assert.equal(stt.isCustomEndpoint, false);
    assert.equal(stt.mode, 'ws'); // default to ws before start() runs
    assert.equal(stt._isActive, false);
  });

  test('switches to rest mode when baseUrl is non-default', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('sk-test', 'https://speaches.example.com/v1/');
    assert.equal(stt.isCustomEndpoint, true);
    assert.match(stt.restEndpoint, /^https:\/\//);
  });

  test('treats an empty baseUrl as the default (ws mode)', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('sk-test', '');
    assert.equal(stt.isCustomEndpoint, false);
  });

  test('falls back to ws mode for whitespace-only baseUrl', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('sk-test', '   ');
    assert.equal(stt.isCustomEndpoint, false);
  });
});

describe('OpenAIStreamingSTT — configuration setters', () => {
  test('setApiKey stores the new key without reconnecting when inactive', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('sk-old');
    stt.setApiKey('sk-new');
    assert.equal(stt.apiKey, 'sk-new');
    // No reconnect timer should be created when inactive.
    assert.equal(stt.reconnectTimer, null);
  });

  test('setSampleRate is a no-op when rate is unchanged', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k');
    stt.setSampleRate(16000);
    assert.equal(stt.inputSampleRate, 16000);
    stt.setSampleRate(16000);
    assert.equal(stt.inputSampleRate, 16000);
    stt.setSampleRate(24000);
    assert.equal(stt.inputSampleRate, 24000);
  });

  test('setAudioChannelCount updates the cached channel count', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k');
    stt.setAudioChannelCount(2);
    assert.equal(stt._numChannels, 2);
  });

  test('setRecognitionLanguage stores the key without restarting while inactive', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k');
    stt.setRecognitionLanguage('chinese');
    assert.equal(stt.languageKey, 'chinese');
  });

  test('setCredentials is a no-op (OpenAI uses API keys, not creds files)', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k');
    assert.doesNotThrow(() => stt.setCredentials('/path/to/key.json'));
  });
});

describe('OpenAIStreamingSTT — lifecycle guards', () => {
  test('start() activates the instance and selects rest mode for custom endpoints', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    stt.start();
    assert.equal(stt._isActive, true);
    assert.equal(stt.mode, 'rest');
    stt.stop();
  });

  test('start() is idempotent (no double state reset)', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    stt.start();
    stt.start();
    assert.equal(stt._isActive, true);
    stt.stop();
  });

  test('stop() before start() is a no-op', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    assert.doesNotThrow(() => stt.stop());
    assert.equal(stt._isActive, false);
  });

  test('write() before start() is silently dropped', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    stt.write(loudPcm16le());
    assert.equal(stt.restChunks.length, 0);
    assert.equal(stt.restTotalBytes, 0);
  });

  test('write() in rest mode accumulates bytes without emitting synchronously', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    const transcripts = [];
    stt.on('transcript', e => transcripts.push(e));
    stt.start();
    stt.write(loudPcm16le(1024));
    stt.write(loudPcm16le(2048));
    assert.equal(stt.restChunks.length, 2);
    assert.equal(stt.restTotalBytes, 1024 * 2 + 2048 * 2);
    assert.equal(transcripts.length, 0);
    stt.stop();
  });

  test('notifySpeechEnded before start() is a no-op', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    assert.doesNotThrow(() => stt.notifySpeechEnded());
  });

  test('finalize before start() is a no-op', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    assert.doesNotThrow(() => stt.finalize());
  });

  test('stop() resets internal state and clears rest chunks', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    stt.start();
    stt.write(loudPcm16le(1024));
    stt.stop();
    assert.equal(stt._isActive, false);
    assert.equal(stt.restChunks.length, 0);
    assert.equal(stt.restTotalBytes, 0);
  });

  test('drainFinals (inherited from BaseSTT) resolves within the timeout', async () => {
    const { OpenAIStreamingSTT } = await loadOpenAIStreamingSTT();
    const stt = new OpenAIStreamingSTT('k', 'https://speaches.example.com/v1/');
    stt.start();
    const startedAt = Date.now();
    await stt.drainFinals(500);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 400 && elapsed < 1000, `expected ~500ms wait, got ${elapsed}ms`);
    stt.stop();
  });
});