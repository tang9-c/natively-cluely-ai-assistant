import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const providerPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/rag/providers/QCloudEmbeddingProvider.js',
);
const constantsPath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/llm/QCloudLlmConstants.js',
);

async function loadModules() {
  const [{ QCloudEmbeddingProvider }, constants] = await Promise.all([
    import(pathToFileURL(providerPath).href),
    import(pathToFileURL(constantsPath).href),
  ]);
  return { QCloudEmbeddingProvider, constants };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

test('QCloudEmbeddingProvider sends the wire alias and exposes the canonical model', async () => {
  const { QCloudEmbeddingProvider, constants } = await loadModules();
  const originalFetch = global.fetch;
  let request;
  global.fetch = async (url, init) => {
    request = { url, init };
    return jsonResponse({ data: [{ index: 0, embedding: [0.1, 0.2, 0.3] }] });
  };

  try {
    const provider = new QCloudEmbeddingProvider('sk-test');
    const vector = await provider.embed('会议文本');

    assert.equal(provider.name, 'qcloud');
    assert.equal(provider.model, 'doubao-embedding-vision-251215');
    assert.deepEqual(vector, [0.1, 0.2, 0.3]);
    assert.equal(request.url, constants.QCLOUD_EMBEDDINGS_ENDPOINT);
    assert.equal(request.init.method, 'POST');
    assert.equal(request.init.headers.Authorization, 'Bearer sk-test');
    assert.deepEqual(JSON.parse(request.init.body), {
      model: 'embedding-vision',
      input: '会议文本',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('QCloudEmbeddingProvider sorts batch results and derives its embedding space', async () => {
  const { QCloudEmbeddingProvider } = await loadModules();
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({
    data: [
      { index: 1, embedding: [0.3, 0.4] },
      { index: 0, embedding: [0.1, 0.2] },
    ],
  });

  try {
    const provider = new QCloudEmbeddingProvider('sk-test');
    assert.deepEqual(await provider.embedBatch(['a', 'b']), [
      [0.1, 0.2],
      [0.3, 0.4],
    ]);
    assert.equal(provider.dimensions, 2);
    assert.equal(provider.space, 'qcloud:doubao-embedding-vision-251215:2');
  } finally {
    global.fetch = originalFetch;
  }
});

test('QCloudEmbeddingProvider does not identify as direct Doubao', async () => {
  const { QCloudEmbeddingProvider } = await loadModules();
  const provider = new QCloudEmbeddingProvider('sk-test');

  assert.notEqual(
    provider.space,
    'doubao:doubao-embedding-vision-251215:0',
  );
});

for (const [name, response] of [
  ['empty data', { data: [] }],
  ['missing vector', { data: [{ index: 0 }] }],
  ['non-finite value', { data: [{ index: 0, embedding: [1, Number.NaN] }] }],
  [
    'inconsistent dimensions',
    {
      data: [
        { index: 0, embedding: [1, 2] },
        { index: 1, embedding: [3] },
      ],
    },
  ],
]) {
  test(`QCloudEmbeddingProvider rejects ${name} without leaking request data`, async () => {
    const { QCloudEmbeddingProvider } = await loadModules();
    const originalFetch = global.fetch;
    global.fetch = async () => jsonResponse(response);
    const secret = 'sk-private-value';
    const input = name === 'inconsistent dimensions'
      ? ['private-a', 'private-b']
      : ['private-a'];

    try {
      const provider = new QCloudEmbeddingProvider(secret);
      await assert.rejects(
        provider.embedBatch(input),
        error => {
          assert.doesNotMatch(error.message, /private-a|private-b|sk-private-value/);
          return true;
        },
      );
      assert.equal(provider.dimensions, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });
}

test('QCloudEmbeddingProvider reports only HTTP status on non-2xx responses', async () => {
  const { QCloudEmbeddingProvider } = await loadModules();
  const originalFetch = global.fetch;
  global.fetch = async () => jsonResponse({ error: 'contains private response data' }, 401);

  try {
    const provider = new QCloudEmbeddingProvider('sk-private-value');
    await assert.rejects(
      provider.embed('private-input'),
      error => {
        assert.match(error.message, /401/);
        assert.doesNotMatch(
          error.message,
          /private-input|sk-private-value|contains private response data/,
        );
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('QCloudEmbeddingProvider sanitizes transport failures', async () => {
  const { QCloudEmbeddingProvider } = await loadModules();
  const originalFetch = global.fetch;
  global.fetch = async () => {
    throw new Error('transport included private-input and sk-private-value');
  };

  try {
    const provider = new QCloudEmbeddingProvider('sk-private-value');
    await assert.rejects(
      provider.embed('private-input'),
      error => {
        assert.doesNotMatch(error.message, /private-input|sk-private-value/);
        return true;
      },
    );
  } finally {
    global.fetch = originalFetch;
  }
});
