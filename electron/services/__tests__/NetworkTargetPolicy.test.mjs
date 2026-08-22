import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/security/NetworkTargetPolicy.js');

async function loadPolicy() {
  return import(pathToFileURL(modulePath).href);
}

test('OpenAI STT network policy requires HTTPS', async () => {
  const { assertSafeHttpsUrl } = await loadPolicy();
  await assert.rejects(
    () => assertSafeHttpsUrl('http://api.example.test', async () => [{ address: '93.184.216.34', family: 4 }]),
    /HTTPS/i,
  );
});

test('OpenAI STT network policy rejects DNS names resolving to private addresses', async () => {
  const { assertSafeHttpsUrl } = await loadPolicy();
  await assert.rejects(
    () => assertSafeHttpsUrl('https://api.example.test', async () => [{ address: '10.0.0.8', family: 4 }]),
    /blocked|private|reserved/i,
  );
});

test('OpenAI STT network policy rejects mixed public and private DNS answers', async () => {
  const { assertSafeHttpsUrl } = await loadPolicy();
  await assert.rejects(
    () => assertSafeHttpsUrl('https://api.example.test', async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '169.254.169.254', family: 4 },
    ]),
    /blocked|private|reserved/i,
  );
});

test('OpenAI STT network policy rejects reserved IPv6 transition and local-use ranges', async () => {
  const { assertSafeHttpsUrl } = await loadPolicy();
  for (const address of ['64:ff9b:1::1', '100::1', '2001::1', '2002:0a00:0001::']) {
    await assert.rejects(
      () => assertSafeHttpsUrl('https://api.example.test', async () => [{ address, family: 6 }]),
      /blocked|private|reserved/i,
    );
  }
});

test('OpenAI STT network policy accepts an HTTPS target with public DNS answers', async () => {
  const { assertSafeHttpsUrl } = await loadPolicy();
  const parsed = await assertSafeHttpsUrl(
    'https://api.example.test/v1',
    async () => [{ address: '93.184.216.34', family: 4 }],
  );
  assert.equal(parsed.hostname, 'api.example.test');
});
