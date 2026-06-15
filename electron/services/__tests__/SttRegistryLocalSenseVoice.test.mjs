import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const registryPath = path.resolve(__dirname, '../../../dist-electron/electron/audio/sttRegistry.js');

test('STT registry creates LocalSenseVoiceSTT without requiring an API key', async () => {
  const { createSTTProvider } = await import(pathToFileURL(registryPath).href);

  const provider = createSTTProvider('local-sensevoice', 'user');

  assert.ok(provider);
  assert.match(provider.constructor.name, /LocalSenseVoiceSTT/);
});
