import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/utils/networkErrorClassifier.js');

async function loadClassifier() {
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('classifies TLS certificate errors from message, code, and nested cause', async () => {
  const { classifyNetworkError } = await loadClassifier();

  const byMessage = classifyNetworkError(new Error('unable to verify the first certificate'));
  assert.equal(byMessage.kind, 'tls_certificate');
  assert.match(byMessage.userMessage, /证书链验证失败/);
  assert.match(byMessage.userMessage, /不是 API Key 错误/);

  const byCode = classifyNetworkError({ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' });
  assert.equal(byCode.kind, 'tls_certificate');

  const byCause = classifyNetworkError({
    cause: {
      cause: {
        code: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
      },
    },
  });
  assert.equal(byCause.kind, 'tls_certificate');
});

test('classifies auth http timeout and network errors', async () => {
  const { classifyNetworkError } = await loadClassifier();

  assert.equal(classifyNetworkError({ response: { status: 401 } }).kind, 'auth');
  assert.equal(classifyNetworkError({ response: { status: 403 } }).kind, 'auth');
  assert.equal(classifyNetworkError({ response: { status: 500 } }).kind, 'http');
  assert.equal(classifyNetworkError({ code: 'ECONNABORTED' }).kind, 'timeout');
  assert.equal(classifyNetworkError({ code: 'ETIMEDOUT' }).kind, 'timeout');
  assert.equal(classifyNetworkError(new Error('request timeout after 15000ms')).kind, 'timeout');
  assert.equal(classifyNetworkError({ code: 'ENOTFOUND' }).kind, 'network');
  assert.equal(classifyNetworkError({ code: 'ECONNRESET' }).kind, 'network');
  assert.equal(classifyNetworkError({ code: 'ECONNREFUSED' }).kind, 'network');
});

test('safe diagnostic excludes credentials headers bodies and private response details', async () => {
  const { toSafeNetworkDiagnostic } = await loadClassifier();
  const error = {
    message: 'request failed with private prompt body token=secret Authorization Bearer',
    code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
    config: {
      headers: {
        Authorization: 'Bearer secret-key',
        'X-Api-Key': 'secret-api-key',
      },
      data: '{"prompt":"secret prompt"}',
    },
    response: {
      status: 0,
      headers: {
        'set-cookie': 'private-cookie',
      },
      data: {
        error: {
          message: 'private server payload',
        },
      },
    },
  };

  const diagnostic = toSafeNetworkDiagnostic(error, {
    provider: 'doubao',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/models?token=private',
  });
  const serialized = JSON.stringify(diagnostic);

  assert.equal(diagnostic.provider, 'doubao');
  assert.equal(diagnostic.endpointHost, 'ark.cn-beijing.volces.com');
  assert.equal(diagnostic.kind, 'tls_certificate');
  assert.equal(diagnostic.status, 0);
  assert.ok(diagnostic.message);
  assert.match(diagnostic.message, /证书链验证失败/);
  assert.doesNotMatch(serialized, /secret-key/);
  assert.doesNotMatch(serialized, /secret-api-key/);
  assert.doesNotMatch(serialized, /Authorization/);
  assert.doesNotMatch(serialized, /X-Api-Key/);
  assert.doesNotMatch(serialized, /private prompt body/);
  assert.doesNotMatch(serialized, /token=secret/);
  assert.doesNotMatch(serialized, /Bearer/);
  assert.doesNotMatch(serialized, /set-cookie/);
  assert.doesNotMatch(serialized, /private server payload/);
  assert.doesNotMatch(serialized, /token=private/);
});

test('classifies DEPTH_ZERO_SELF_SIGNED_CERT as TLS certificate error', async () => {
  const { classifyNetworkError } = await loadClassifier();
  assert.equal(classifyNetworkError({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' }).kind, 'tls_certificate');
});
