import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const modulePath = path.resolve(
  __dirname,
  '../../../dist-electron/electron/llm/QCloudSkillError.js',
);

function loadModule() {
  delete require.cache[modulePath];
  return require(modulePath);
}

test('classifies balance before generic 403 authentication', () => {
  const { normalizeQCloudSkillError } = loadModule();
  const error = normalizeQCloudSkillError(new Error(
    'QCLOUD API 403: The request failed because your account has an overdue balance. Request id: req_balance_1',
  ));

  assert.equal(error.code, 'balance');
  assert.equal(error.userMessage, 'QCLOUD 账户余额不足，请充值后重试。');
  assert.deepEqual(error.toSafeLogFields(), {
    code: 'balance',
    status: 403,
    requestId: 'req_balance_1',
    retryable: false,
  });
});

test('classifies invalid request, authentication, rate limit and timeout', () => {
  const { normalizeQCloudSkillError } = loadModule();
  const cases = [
    [new Error('QCLOUD API 400: Invalid combination of reasoning_effort and thinking type. Request id: req_400'), 'invalid_request', 'AI 请求配置不兼容，请更新软件或联系支持。'],
    [new Error('QCLOUD API 401: Invalid API key. Request id: req_401'), 'authentication', 'QCLOUD API Key 无效或已失效，请重新配置。'],
    [new Error('QCLOUD API key not set'), 'authentication', 'QCLOUD API Key 无效或已失效，请重新配置。'],
    [new Error('QCLOUD API 403: Access denied. Request id: req_403'), 'authentication', 'QCLOUD 鉴权或访问权限校验失败，请检查 API Key。'],
    [new Error('QCLOUD API 429: rate limit exceeded. Request id: req_429'), 'rate_limit', '请求过于频繁，请稍后重试。'],
    [new Error('QCLOUD API request timed out after 120000ms'), 'timeout', 'AI 服务响应超时，请检查网络后重试。'],
  ];

  for (const [input, code, message] of cases) {
    const result = normalizeQCloudSkillError(input);
    assert.equal(result.code, code);
    assert.equal(result.userMessage, message);
  }
});

test('classifies malformed and empty responses without exposing provider body', () => {
  const { QCloudSkillError, normalizeQCloudSkillError } = loadModule();
  const malformed = normalizeQCloudSkillError(new SyntaxError('Unexpected token < in JSON'));
  const empty = new QCloudSkillError('invalid_response');

  assert.equal(malformed.code, 'invalid_response');
  assert.equal(empty.userMessage, 'AI 服务未返回有效内容，请稍后重试。');
  assert.equal(JSON.stringify(empty.toSafeLogFields()).includes('Unexpected token'), false);
});

test('classifies 5xx and unknown failures without returning raw messages', () => {
  const { normalizeQCloudSkillError } = loadModule();
  const unavailable = normalizeQCloudSkillError(new Error('QCLOUD API 503: upstream unavailable Request id: req_503'));
  const unknown = normalizeQCloudSkillError(new Error('secret provider implementation detail'));

  assert.equal(unavailable.code, 'service_unavailable');
  assert.equal(unavailable.userMessage, 'AI 服务暂时不可用，请稍后重试。');
  assert.equal(unknown.code, 'unknown');
  assert.equal(unknown.userMessage, 'AI 服务调用失败，请稍后重试。');
  assert.equal(unknown.userMessage.includes('secret provider implementation detail'), false);
});
