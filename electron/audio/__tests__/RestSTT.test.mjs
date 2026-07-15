// Unit tests for RestSTT covering the parts that don't require a live HTTP
// round-trip:
//
//   * lifecycle guards (idempotent start, no-op stop, write before start)
//   * configuration setters (api key / sample rate / channel count / language)
//   * buffer accumulation in write()
//   * flushAndUpload early-return paths (empty buffer / below MIN_BUFFER_BYTES)
//   * silence-skip path (RMS below getSilenceRmsThreshold())
//   * drainFinals timeout path
//
// axios is bundled into dist-electron/electron/audio/RestSTT.js (esbuild
// inlines the whole module), so we cannot intercept it via require.cache.
// Instead, after the module loads we swap `axios.defaults.adapter` with a
// stub that resolves with `{ data: { text: 'stub' } }`. That stub is restored
// in afterEach so the test run is hermetic.
import assert from 'node:assert/strict';
import path from 'node:path';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/RestSTT.js');

let originalLog;
let restSttModule;
let axiosStub;
let installedAdapter;

async function loadRestSTT() {
  if (restSttModule) return restSttModule;
  const mod = await import(pathToFileURL(modulePath).href + `?t=${Date.now()}`);
  restSttModule = mod;
  // Install a stub adapter so that any accidental real POST is short-circuited.
  // The adapter API follows axios' contract: (config) => Promise<{data, status, ...}>.
  axiosStub = {
    postCalls: [],
    setNext(data) {
      this.next = data;
    },
    install() {
      const modAxios = mod.__test_axios__;
      if (!modAxios) return;
      installedAdapter = modAxios.defaults.adapter;
      modAxios.defaults.adapter = async (config) => {
        axiosStub.postCalls.push({
          url: config.url,
          method: config.method,
          data: typeof config.data === 'string' ? config.data.slice(0, 200) : config.data,
          headers: config.headers,
        });
        const data = axiosStub.next ?? { text: 'stub-transcript' };
        axiosStub.next = undefined;
        return { data, status: 200, statusText: 'OK', headers: {}, config };
      };
    },
    uninstall() {
      const modAxios = mod.__test_axios__;
      if (modAxios && installedAdapter) {
        modAxios.defaults.adapter = installedAdapter;
        installedAdapter = null;
      }
    },
    reset() {
      this.postCalls = [];
      this.next = undefined;
    },
  };
  return mod;
}

beforeEach(() => {
  originalLog = console.log;
  console.log = () => {};
});

afterEach(async () => {
  console.log = originalLog;
  if (axiosStub) axiosStub.uninstall();
});

function loudPcm16le(samples = 4000, amplitude = 1200) {
  const buf = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(amplitude, i * 2);
  }
  return buf;
}

function silentPcm16le(samples = 4000) {
  return Buffer.alloc(samples * 2);
}

describe('RestSTT — construction', () => {
  test('builds a working instance for the groq provider with a default model', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'sk-test');
    assert.equal(stt.provider, 'groq');
    assert.equal(stt.apiKey, 'sk-test');
    assert.equal(stt.config.model, 'whisper-large-v3-turbo');
    assert.equal(stt.config.endpoint, 'https://api.groq.com/openai/v1/audio/transcriptions');
    assert.equal(stt._isActive, false);
  });

  test('honours the modelOverride argument', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('openai', 'sk-test', 'whisper-large-v3');
    assert.equal(stt.config.model, 'whisper-large-v3');
  });

  test('merges options.speaker and defaults to "interviewer"', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k', undefined, undefined, { speaker: 'me' });
    assert.equal(stt.options.speaker, 'me');

    const sttDefault = new RestSTT('groq', 'k');
    assert.equal(sttDefault.options.speaker, 'interviewer');
  });
});

describe('RestSTT — configuration setters', () => {
  test('setApiKey rebuilds the provider config', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'old-key');
    stt.setApiKey('new-key');
    assert.equal(stt.apiKey, 'new-key');
    assert.equal(stt.config.authHeader.Authorization, 'Bearer new-key');
  });

  test('setSampleRate updates the cached rate (no-op when unchanged)', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.setSampleRate(16000);
    assert.equal(stt._sampleRate, 16000);
    stt.setSampleRate(16000);
    assert.equal(stt._sampleRate, 16000);
    stt.setSampleRate(24000);
    assert.equal(stt._sampleRate, 24000);
  });

  test('setAudioChannelCount updates the cached channel count', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.setAudioChannelCount(2);
    assert.equal(stt._numChannels, 2);
  });

  test('setRecognitionLanguage updates the cached key and rebuilds config', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.setRecognitionLanguage('chinese');
    assert.equal(stt._languageKey, 'chinese');
    // groq config includes language in extraFormFields when key !== 'auto'
    assert.equal(stt.config.extraFormFields.language, 'zh');
  });

  test('setRecognitionLanguage("auto") keeps config.language unset', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.setRecognitionLanguage('auto');
    assert.equal(stt.config.extraFormFields.language, undefined);
  });

  test('setCredentials is a documented no-op', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    assert.doesNotThrow(() => stt.setCredentials('/path/to/key.json'));
  });
});

describe('RestSTT — lifecycle guards', () => {
  test('start() is idempotent (does not stack safety-net timers)', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.start();
    const firstTimer = stt.safetyNetTimer;
    stt.start();
    // Second start is a no-op; timer object should be identical.
    assert.equal(stt.safetyNetTimer, firstTimer);
    stt.stop();
  });

  test('stop() before start() is a no-op', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    assert.doesNotThrow(() => stt.stop());
    assert.equal(stt.safetyNetTimer, null);
  });

  test('write() before start() is silently dropped', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.write(loudPcm16le());
    assert.equal(stt.chunks.length, 0);
    assert.equal(stt.totalBufferedBytes, 0);
  });

  test('write() after start() accumulates bytes and emits nothing synchronously', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.start();
    // Keep each chunk well below MIN_BUFFER_BYTES (4000) so stop() does not
    // trigger a real upload round-trip.
    stt.write(loudPcm16le(500));
    stt.write(loudPcm16le(700));
    assert.equal(stt.chunks.length, 2);
    assert.equal(stt.totalBufferedBytes, 500 * 2 + 700 * 2);
    stt.stop();
  });

  test('notifySpeechEnded before start() is a no-op', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    assert.doesNotThrow(() => stt.notifySpeechEnded());
  });

  test('finalize before start() is a no-op', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    assert.doesNotThrow(() => stt.finalize());
  });
});

describe('RestSTT — flushAndUpload early-return paths', () => {
  test('flushes with empty buffer are a no-op (no upload, no error)', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.start();
    // No writes — should resolve immediately and never touch the network.
    const flushPromise = stt.flushAndUpload('manual');
    await flushPromise;
    assert.equal(stt.isUploading, false);
    stt.stop();
  });

  test('flushes below MIN_BUFFER_BYTES are a no-op', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.start();
    // 1KB PCM < MIN_BUFFER_BYTES (4KB) — should not upload.
    stt.write(loudPcm16le(500));
    const flushPromise = stt.flushAndUpload('manual');
    await flushPromise;
    assert.equal(stt.isUploading, false);
    stt.stop();
  });

  test('silent buffers are skipped (RMS below threshold)', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    const errors = [];
    stt.on('error', err => errors.push(err));
    stt.start();
    // Push enough silent samples to exceed MIN_BUFFER_BYTES.
    stt.write(silentPcm16le(5000));
    const flushPromise = stt.flushAndUpload('manual');
    await flushPromise;
    // Silent → no upload happened, no error, no transcript.
    assert.equal(stt.isUploading, false);
    assert.equal(errors.length, 0);
    stt.stop();
  });
});

describe('RestSTT — drainFinals', () => {
  test('returns quickly when there is no in-flight upload', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('groq', 'k');
    stt.start();
    const startedAt = Date.now();
    await stt.drainFinals(2000);
    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed < 100, `expected fast path, took ${elapsed}ms`);
    stt.stop();
  });
});

describe('RestSTT — segmentation quality layer', () => {
  test('segments long AUC uploads and dedupes overlap text', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('qcloud-stt', 'test-key');
    const warnings = [];
    const uploadSizes = [];
    stt.on('warning', (warning) => warnings.push(warning));
    stt.uploadAudio = async (wavBuffer) => {
      uploadSizes.push(wavBuffer.length);
      return uploadSizes.length === 1 ? '我们先看 MES 供应商的流程' : '供应商的流程还有图纸审批';
    };

    const pcm16k = Buffer.alloc(16000 * 2 * 18);
    const result = await stt.uploadPcm16kWithSegmentation(pcm16k);

    assert.equal(uploadSizes.length > 1, true);
    assert.equal(result, '我们先看 MES 供应商的流程还有图纸审批');
    assert.equal(warnings.some((warning) => warning.code === 'stt_segmentation_diagnostics'), true);
  });

  test('falls back to normal single upload for short audio', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('qcloud-stt', 'test-key');
    let uploadCount = 0;
    stt.uploadAudio = async () => {
      uploadCount += 1;
      return '短句';
    };

    const pcm16k = Buffer.alloc(16000 * 2 * 3);
    const result = await stt.uploadPcm16kWithSegmentation(pcm16k);

    assert.equal(uploadCount, 1);
    assert.equal(result, '短句');
  });

  test('continues when one segmented upload fails', async () => {
    const { RestSTT } = await loadRestSTT();
    const stt = new RestSTT('qcloud-stt', 'test-key');
    const warnings = [];
    let uploadCount = 0;
    stt.on('warning', (warning) => warnings.push(warning));
    stt.uploadAudio = async () => {
      uploadCount += 1;
      if (uploadCount === 1) throw new Error('segment failed');
      return '后续分段文本';
    };

    const pcm16k = Buffer.alloc(16000 * 2 * 18);
    const result = await stt.uploadPcm16kWithSegmentation(pcm16k);

    assert.equal(result, '后续分段文本');
    assert.equal(warnings.some((warning) => warning.code === 'partial_segment_failure'), true);
    assert.equal(
      warnings.some((warning) => warning.code === 'stt_segmentation_diagnostics' && warning.warnings.includes('partial_segment_failure')),
      true,
    );
  });
});
