import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sensevoice/modelDownloader.js');

async function loadDownloader() {
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'sensevoice-download-'));
}

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server.address().port));
  });
}

function close(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('SenseVoice downloader falls back to the next endpoint when the first endpoint fails', async (t) => {
  const modelsDir = makeTempDir();
  const failingServer = http.createServer((_, res) => {
    res.writeHead(503);
    res.end('temporary unavailable');
  });
  const servingServer = http.createServer((req, res) => {
    const filename = req.url?.endsWith('/model.int8.onnx')
      ? 'model.int8.onnx'
      : req.url?.endsWith('/tokens.txt')
        ? 'tokens.txt'
        : '';
    if (!filename) {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'content-length': String(filename.length) });
    res.end(filename);
  });

  const failingPort = await listen(failingServer);
  const servingPort = await listen(servingServer);
  t.after(async () => {
    await close(failingServer);
    await close(servingServer);
    fs.rmSync(modelsDir, { recursive: true, force: true });
    delete process.env.SENSEVOICE_MODELS_DIR;
    delete process.env.SENSEVOICE_MODEL_ENDPOINTS;
    delete process.env.SENSEVOICE_MODEL_FILE_BASE_URLS;
  });

  process.env.SENSEVOICE_MODELS_DIR = modelsDir;
  process.env.SENSEVOICE_MODEL_ENDPOINTS = [
    `http://127.0.0.1:${failingPort}`,
    `http://127.0.0.1:${servingPort}`,
  ].join(',');

  const { downloadSenseVoiceModel } = await loadDownloader();
  const progress = [];
  await downloadSenseVoiceModel(undefined, value => progress.push(value));

  const modelDir = path.join(
    modelsDir,
    'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  );
  assert.equal(fs.readFileSync(path.join(modelDir, 'model.int8.onnx'), 'utf8'), 'model.int8.onnx');
  assert.equal(fs.readFileSync(path.join(modelDir, 'tokens.txt'), 'utf8'), 'tokens.txt');
  assert.equal(progress.at(-1), 100);
});

test('SenseVoice downloader supports full file base URLs for ModelScope-style mirrors', async (t) => {
  const modelsDir = makeTempDir();
  const failingServer = http.createServer((_, res) => {
    res.writeHead(503);
    res.end('temporary unavailable');
  });
  const servingServer = http.createServer((req, res) => {
    const prefix = '/models/chriscrs/sensevoice/resolve/master/';
    if (!req.url?.startsWith(prefix)) {
      res.writeHead(404);
      res.end('wrong path');
      return;
    }
    const filename = req.url.slice(prefix.length);
    if (filename !== 'model.int8.onnx' && filename !== 'tokens.txt') {
      res.writeHead(404);
      res.end('missing');
      return;
    }
    res.writeHead(200, { 'content-length': String(filename.length) });
    res.end(filename);
  });

  const failingPort = await listen(failingServer);
  const servingPort = await listen(servingServer);
  t.after(async () => {
    await close(failingServer);
    await close(servingServer);
    fs.rmSync(modelsDir, { recursive: true, force: true });
    delete process.env.SENSEVOICE_MODELS_DIR;
    delete process.env.SENSEVOICE_MODEL_ENDPOINTS;
    delete process.env.SENSEVOICE_MODEL_FILE_BASE_URLS;
  });

  process.env.SENSEVOICE_MODELS_DIR = modelsDir;
  process.env.SENSEVOICE_MODEL_FILE_BASE_URLS = [
    `http://127.0.0.1:${failingPort}/models/chriscrs/sensevoice/resolve/master`,
    `http://127.0.0.1:${servingPort}/models/chriscrs/sensevoice/resolve/master`,
  ].join(',');

  const { downloadSenseVoiceModel } = await loadDownloader();
  await downloadSenseVoiceModel();

  const modelDir = path.join(
    modelsDir,
    'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  );
  assert.equal(fs.readFileSync(path.join(modelDir, 'model.int8.onnx'), 'utf8'), 'model.int8.onnx');
  assert.equal(fs.readFileSync(path.join(modelDir, 'tokens.txt'), 'utf8'), 'tokens.txt');
});

test('SenseVoice downloader redacts signed query parameters from download errors', async (t) => {
  const modelsDir = makeTempDir();
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith('/source/model.int8.onnx')) {
      res.writeHead(302, {
        location: '/signed/model.int8.onnx?X-Amz-Signature=secret&Policy=private',
      });
      res.end();
      return;
    }
    res.writeHead(503);
    res.end('temporary unavailable');
  });

  const port = await listen(server);
  t.after(async () => {
    await close(server);
    fs.rmSync(modelsDir, { recursive: true, force: true });
    delete process.env.SENSEVOICE_MODELS_DIR;
    delete process.env.SENSEVOICE_MODEL_ENDPOINTS;
    delete process.env.SENSEVOICE_MODEL_FILE_BASE_URLS;
  });

  process.env.SENSEVOICE_MODELS_DIR = modelsDir;
  process.env.SENSEVOICE_MODEL_FILE_BASE_URLS = `http://127.0.0.1:${port}/source`;

  const { downloadSenseVoiceModel } = await loadDownloader();
  await assert.rejects(
    () => downloadSenseVoiceModel(),
    (error) => {
      assert.match(error.message, /signed\/model\.int8\.onnx/);
      assert.doesNotMatch(error.message, /X-Amz-Signature|secret|Policy=private/);
      return true;
    },
  );
});
