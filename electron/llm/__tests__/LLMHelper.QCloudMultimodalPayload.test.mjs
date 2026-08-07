import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { LLMHelper } = require('../../../dist-electron/electron/LLMHelper.js');
const sharp = require('sharp');

async function withCapturedFetch(run) {
  const requests = [];
  const originalFetch = global.fetch;
  global.fetch = async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Response(JSON.stringify({
      choices: [{ message: { content: 'vision-ok' } }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    await run(requests);
  } finally {
    global.fetch = originalFetch;
  }
}

async function createImage() {
  const imagePath = path.join(os.tmpdir(), `qcloud-multimodal-${Date.now()}.jpg`);
  await sharp({
    create: { width: 8, height: 8, channels: 3, background: '#ffffff' },
  }).jpeg().toFile(imagePath);
  return imagePath;
}

function assertOpenAiMultimodalBody(body, expectedText) {
  const userMessage = body.messages.at(-1);
  assert.equal(userMessage.role, 'user');
  assert.equal(Array.isArray(userMessage.content), true);
  assert.deepEqual(userMessage.content[0], { type: 'text', text: expectedText });
  assert.equal(userMessage.content[1].type, 'image_url');
  assert.match(userMessage.content[1].image_url.url, /^data:image\/jpeg;base64,/);
  assert.equal(Object.hasOwn(body, 'images'), false);
}

test('non-streaming QCLOUD sends images inside OpenAI-compatible user content', async () => {
  const imagePath = await createImage();
  const helper = new LLMHelper();
  helper.setNativelyKey('test-key');
  helper.setModel('natively');

  try {
    await withCapturedFetch(async (requests) => {
      const result = await helper.generatePptxKnowledgeWithNatively('describe slide', undefined, [imagePath]);
      assert.equal(result, 'vision-ok');
      assert.equal(requests.length, 1);
      assertOpenAiMultimodalBody(requests[0], 'describe slide');
    });
  } finally {
    fs.rmSync(imagePath, { force: true });
  }
});

test('streaming QCLOUD sends images inside OpenAI-compatible user content', async () => {
  const imagePath = await createImage();
  const helper = new LLMHelper();
  helper.setNativelyKey('test-key');

  try {
    await withCapturedFetch(async (requests) => {
      const chunks = [];
      for await (const chunk of helper.streamWithNatively(
        'describe screen',
        undefined,
        [imagePath],
        { dataScopes: ['reference_files', 'screenshots'] },
      )) {
        chunks.push(chunk);
      }
      assert.deepEqual(chunks, ['vision-ok']);
      assert.equal(requests.length, 1);
      assertOpenAiMultimodalBody(requests[0], 'describe screen');
    });
  } finally {
    fs.rmSync(imagePath, { force: true });
  }
});

test('text-only QCLOUD requests keep string content', async () => {
  const helper = new LLMHelper();
  helper.setNativelyKey('test-key');
  helper.setModel('natively');

  await withCapturedFetch(async (requests) => {
    await helper.generatePptxKnowledgeWithNatively('text only');
    assert.equal(requests[0].messages.at(-1).content, 'text only');
    assert.equal(Object.hasOwn(requests[0], 'images'), false);
  });
});
