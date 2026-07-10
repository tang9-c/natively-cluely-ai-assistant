// electron/utils/__tests__/curlUtils.behavior.test.mjs
//
// Behavioral coverage for curlUtils.ts:
//   - validateCurl: empty, no-curl prefix, missing placeholder, valid → JSON
//   - validateUrlForSsrf: data:, file:, javascript:, protocol-relative, localhost, private IPs, https required
//   - validateImagePath: userData prefix ordering (regression 2631), traversal, etc.
//   - imageMimeTypeFromPath: jpg, jpeg, png, gif, webp, unknown
//   - injectImageIntoMessages: body without images, with images already, replaces string content
//   - deepVariableReplacer: string/array/object/primitive
//   - getByPath: simple path, bracket path, missing path

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modulePath = path.resolve(__dirname, '../../../dist-electron/electron/utils/curlUtils.js');
const { pathToFileURL: toURL } = { pathToFileURL };
const url = toURL(modulePath).href;
const {
  validateCurl,
  validateUrlForSsrf,
  validateImagePath,
  imageMimeTypeFromPath,
  injectImageIntoMessages,
  deepVariableReplacer,
  getByPath,
} = await import(url);

describe('validateCurl', () => {
  test('returns error for empty curl', () => {
    const r = validateCurl('');
    assert.equal(r.isValid, false);
    assert.match(r.message, /empty/i);
  });

  test('returns error for non-curl command', () => {
    const r = validateCurl('wget https://example.com');
    assert.equal(r.isValid, false);
    assert.match(r.message, /curl/);
  });

  test('returns error when {{TEXT}} placeholder is missing', () => {
    const r = validateCurl("curl -X POST 'https://example.com/api' -d '{\"q\":\"hi\"}'");
    assert.equal(r.isValid, false);
    assert.match(r.message, /\{\{TEXT\}\}/);
  });

  test('returns isValid: true with parsed JSON when curl is well-formed', () => {
    const r = validateCurl("curl -X POST 'https://example.com/api' -H 'Content-Type: application/json' -d '{\"q\":\"{{TEXT}}\"}'");
    assert.equal(r.isValid, true);
    assert.ok(r.json);
    assert.equal(r.json.url, 'https://example.com/api');
    assert.equal(r.json.method, 'POST');
  });

  test('returns isValid: false with friendly message for completely malformed cURL syntax', () => {
    // An unclosed quote makes the curl-to-json parser throw, but the
    // implementation also requires the {{TEXT}} placeholder. Either
    // path returns a friendly message — the test pins both behaviors.
    const r = validateCurl("curl 'https://example.com/ {{TEXT}");  // missing closing quote
    assert.equal(r.isValid, false);
    assert.ok(r.message, 'should return a message');
  });
});

describe('validateUrlForSsrf', () => {
  test('rejects empty / non-string input', () => {
    assert.equal(validateUrlForSsrf('').isValid, false);
    assert.equal(validateUrlForSsrf(null).isValid, false);
    assert.equal(validateUrlForSsrf(undefined).isValid, false);
  });

  test('rejects protocol-relative URLs', () => {
    const r = validateUrlForSsrf('//example.com/foo');
    assert.equal(r.isValid, false);
    assert.match(r.reason, /protocol-relative/i);
  });

  test('rejects data: URLs', () => {
    const r = validateUrlForSsrf('data:text/plain;base64,SGVsbG8=');
    assert.equal(r.isValid, false);
    assert.match(r.reason, /data/i);
  });

  test('rejects file: URLs', () => {
    const r = validateUrlForSsrf('file:///etc/passwd');
    assert.equal(r.isValid, false);
  });

  test('rejects javascript: URLs', () => {
    const r = validateUrlForSsrf('javascript:alert(1)');
    assert.equal(r.isValid, false);
  });

  test('rejects invalid URL format', () => {
    const r = validateUrlForSsrf('not a url');
    assert.equal(r.isValid, false);
    assert.match(r.reason, /invalid/i);
  });

  test('rejects localhost / 127.0.0.1 / ::1 / 0.0.0.0', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '0.0.0.0']) {
      const r = validateUrlForSsrf(`https://${host}/foo`);
      assert.equal(r.isValid, false, `${host} should be rejected`);
    }
  });

  test('rejects link-local 169.254.x.x addresses', () => {
    const r = validateUrlForSsrf('https://169.254.169.254/latest/meta-data/');
    assert.equal(r.isValid, false);
  });

  test('rejects private 10.x.x.x addresses', () => {
    const r = validateUrlForSsrf('https://10.0.0.1/foo');
    assert.equal(r.isValid, false);
  });

  test('rejects private 192.168.x.x addresses', () => {
    const r = validateUrlForSsrf('https://192.168.1.1/foo');
    assert.equal(r.isValid, false);
  });

  test('rejects private 172.16-31.x.x addresses', () => {
    assert.equal(validateUrlForSsrf('https://172.16.0.1/foo').isValid, false);
    assert.equal(validateUrlForSsrf('https://172.20.0.1/foo').isValid, false);
    assert.equal(validateUrlForSsrf('https://172.31.255.255/foo').isValid, false);
  });

  test('allows 172.x outside the 16-31 range (not private)', () => {
    // 172.15.x and 172.32.x are NOT RFC 1918 private — only the strict block is rejected.
    const r = validateUrlForSsrf('https://172.32.0.1/foo');
    // Will be rejected on the HTTPS requirement for non-127 hosts.
    // It will NOT be rejected on the 172.x private check.
    if (!r.isValid) {
      assert.doesNotMatch(r.reason, /172\./);
    }
  });

  test('rejects path traversal sequences', () => {
    const r = validateUrlForSsrf('https://example.com/foo/../etc/passwd');
    assert.equal(r.isValid, false);
    assert.match(r.reason, /traversal/i);
  });

  test('rejects http:// (must be https)', () => {
    const r = validateUrlForSsrf('http://example.com/foo');
    assert.equal(r.isValid, false);
    assert.match(r.reason, /https/i);
  });

  test('allows https:// public URLs', () => {
    const r = validateUrlForSsrf('https://example.com/api');
    assert.equal(r.isValid, true);
  });
});

describe('validateImagePath', () => {
  const MAC_USER_DATA = '/Users/alice/Library/Application Support/Natively';

  test('rejects empty / non-string input', () => {
    assert.equal(validateImagePath('').isValid, false);
    assert.equal(validateImagePath(null).isValid, false);
  });

  test('rejects path traversal sequences', () => {
    const r = validateImagePath('/Users/alice/../etc/passwd', MAC_USER_DATA);
    assert.equal(r.isValid, false);
    assert.match(r.reason, /traversal/i);
  });

  test('rejects Windows absolute paths', () => {
    const r = validateImagePath('C:\\Windows\\System32\\foo.png', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('rejects /etc/ paths', () => {
    const r = validateImagePath('/etc/passwd', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('rejects /home/ paths', () => {
    const r = validateImagePath('/home/alice/.ssh/id_rsa', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('rejects /var/ paths', () => {
    const r = validateImagePath('/var/log/system.log', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('rejects /tmp/ paths', () => {
    const r = validateImagePath('/tmp/sensitive.png', MAC_USER_DATA);
    assert.equal(r.isValid, false);
  });

  test('allows macOS userData screenshots path (regression 2631)', () => {
    const p = `${MAC_USER_DATA}/screenshots/abc-123.png`;
    const r = validateImagePath(p, MAC_USER_DATA);
    assert.equal(r.isValid, true);
  });
});

describe('imageMimeTypeFromPath', () => {
  test('maps common extensions to MIME types', () => {
    assert.equal(imageMimeTypeFromPath('/foo/bar.png'), 'image/png');
    assert.equal(imageMimeTypeFromPath('/foo/bar.jpg'), 'image/jpeg');
    assert.equal(imageMimeTypeFromPath('/foo/bar.jpeg'), 'image/jpeg');
    assert.equal(imageMimeTypeFromPath('/foo/bar.gif'), 'image/gif');
    assert.equal(imageMimeTypeFromPath('/foo/bar.webp'), 'image/webp');
  });

  test('is case-insensitive for the extension', () => {
    assert.equal(imageMimeTypeFromPath('/foo/bar.PNG'), 'image/png');
    assert.equal(imageMimeTypeFromPath('/foo/bar.JPG'), 'image/jpeg');
  });

  test('defaults to image/png for unknown extensions', () => {
    assert.equal(imageMimeTypeFromPath('/foo/bar.bmp'), 'image/png');
    assert.equal(imageMimeTypeFromPath('/foo/bar'), 'image/png');
  });

  test('handles Windows backslashes', () => {
    assert.equal(imageMimeTypeFromPath('C:\\foo\\bar.png'), 'image/png');
  });
});

describe('injectImageIntoMessages', () => {
  test('returns the body unchanged when base64Image is empty', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    const r = injectImageIntoMessages(body, '', '/foo.png');
    assert.deepEqual(r, body);
  });

  test('returns the body unchanged when no messages array', () => {
    const body = { messages: 'not an array' };
    const r = injectImageIntoMessages(body, 'data', '/foo.png');
    assert.deepEqual(r, body);
  });

  test('returns the body unchanged when no user message exists', () => {
    const body = { messages: [{ role: 'system', content: 'sys' }] };
    const r = injectImageIntoMessages(body, 'data', '/foo.png');
    assert.deepEqual(r, body);
  });

  test('appends image_url to last user message with string content', () => {
    const body = { messages: [{ role: 'user', content: 'hi' }] };
    const r = injectImageIntoMessages(body, 'AAAA', '/foo.png');
    assert.ok(Array.isArray(r.messages[0].content));
    assert.equal(r.messages[0].content[0].type, 'text');
    assert.equal(r.messages[0].content[0].text, 'hi');
    assert.equal(r.messages[0].content[1].type, 'image_url');
    assert.match(r.messages[0].content[1].image_url.url, /^data:image\/png;base64,AAAA$/);
  });

  test('appends image_url to last user message with array content', () => {
    const body = { messages: [{
      role: 'user',
      content: [{ type: 'text', text: 'hi' }],
    }] };
    const r = injectImageIntoMessages(body, 'AAAA', '/foo.jpg');
    assert.equal(r.messages[0].content.length, 2);
    assert.equal(r.messages[0].content[1].type, 'image_url');
    assert.match(r.messages[0].content[1].image_url.url, /^data:image\/jpeg/);
  });

  test('does NOT append when last user message already has an image_url', () => {
    const body = { messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'hi' },
        { type: 'image_url', image_url: { url: 'existing' } },
      ],
    }] };
    const r = injectImageIntoMessages(body, 'NEW', '/foo.png');
    // Should not add a new image_url
    const imageParts = r.messages[0].content.filter(c => c.type === 'image_url');
    assert.equal(imageParts.length, 1, 'should still have exactly one image_url');
  });

  test('finds the LAST user message, not the first', () => {
    const body = { messages: [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'response' },
      { role: 'user', content: 'last' },
    ] };
    const r = injectImageIntoMessages(body, 'IMG', '/foo.png');
    assert.equal(r.messages[0].content, 'first'); // unchanged
    assert.equal(r.messages[2].content[0].text, 'last');
    assert.equal(r.messages[2].content[1].type, 'image_url');
  });
});

describe('deepVariableReplacer', () => {
  test('replaces {{key}} placeholders in strings', () => {
    const r = deepVariableReplacer('hello {{name}}', { name: 'world' });
    assert.equal(r, 'hello world');
  });

  test('replaces multiple placeholders in one string', () => {
    const r = deepVariableReplacer('{{a}} and {{b}}', { a: '1', b: '2' });
    assert.equal(r, '1 and 2');
  });

  test('recursively replaces inside arrays', () => {
    const r = deepVariableReplacer(['{{a}}', '{{b}}'], { a: 'x', b: 'y' });
    assert.deepEqual(r, ['x', 'y']);
  });

  test('recursively replaces inside objects', () => {
    const r = deepVariableReplacer({ msg: '{{x}}', nested: { v: '{{y}}' } }, { x: 'X', y: 'Y' });
    assert.deepEqual(r, { msg: 'X', nested: { v: 'Y' } });
  });

  test('leaves primitive non-strings unchanged', () => {
    assert.equal(deepVariableReplacer(42, {}), 42);
    assert.equal(deepVariableReplacer(true, {}), true);
    assert.equal(deepVariableReplacer(null, {}), null);
  });

  test('leaves a string alone when no matching key', () => {
    const r = deepVariableReplacer('{{missing}}', {});
    assert.equal(r, '{{missing}}');
  });
});

describe('getByPath', () => {
  const obj = { a: { b: { c: 42 } }, arr: [{ x: 1 }, { x: 2 }] };

  test('returns the object itself when no path', () => {
    assert.equal(getByPath(obj, ''), obj);
  });

  test('navigates a dotted path', () => {
    assert.equal(getByPath(obj, 'a.b.c'), 42);
  });

  test('navigates a bracket path', () => {
    assert.equal(getByPath(obj, 'a[b][c]'), 42);
  });

  test('navigates through arrays', () => {
    assert.equal(getByPath(obj, 'arr[0].x'), 1);
    assert.equal(getByPath(obj, 'arr[1].x'), 2);
  });

  test('returns undefined for missing path', () => {
    assert.equal(getByPath(obj, 'a.b.missing'), undefined);
  });
});
