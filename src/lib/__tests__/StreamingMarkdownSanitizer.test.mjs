import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const require = createRequire(import.meta.url);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function loadSanitizerWithMockDomPurify() {
  const source = read('src/lib/streamingMarkdownSanitizer.ts');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'streamingMarkdownSanitizer.ts',
  }).outputText;

  const sanitizeCalls = [];
  const domPurifyMock = {
    sanitize(html, config) {
      sanitizeCalls.push({ html, config });
      return html;
    },
  };
  const module = { exports: {} };

  vm.runInNewContext(compiled, {
    exports: module.exports,
    module,
    require(specifier) {
      if (specifier === 'dompurify') {
        return { __esModule: true, default: domPurifyMock };
      }
      return require(specifier);
    },
  });

  return { exports: module.exports, sanitizeCalls };
}

test('streaming markdown sanitizer strips raw HTML before DOMPurify', () => {
  const { exports, sanitizeCalls } = loadSanitizerWithMockDomPurify();

  const html = exports.renderSafeStreamingMarkdown(`
# Safe title

**safe bold** and \`safe code\`

<img src=x onerror="alert(1)">

<svg><script>alert(1)</script></svg>

<template><selectedcontent></selectedcontent></template>

[bad](javascript:alert(1))
`);

  assert.equal(sanitizeCalls.length, 1);
  assert.equal(html, sanitizeCalls[0].html);
  assert.match(html, /<h1>Safe title<\/h1>/);
  assert.match(html, /<strong>safe bold<\/strong>/);
  assert.match(html, /<code>safe code<\/code>/);
  assert.doesNotMatch(html, /<img|onerror|<svg|<script|<template|selectedcontent|javascript:/i);
});

test('streaming markdown sanitizer uses a narrow DOMPurify allowlist', () => {
  const { exports, sanitizeCalls } = loadSanitizerWithMockDomPurify();

  exports.renderSafeStreamingMarkdown('[ok](https://example.com)');

  const config = sanitizeCalls[0].config;
  assert.deepEqual(config.ALLOW_DATA_ATTR, false);
  assert.ok(config.ALLOWED_TAGS.includes('a'));
  assert.ok(config.ALLOWED_TAGS.includes('code'));
  assert.ok(config.ALLOWED_ATTR.includes('href'));
  assert.ok(config.FORBID_TAGS.includes('img'));
  assert.ok(config.FORBID_TAGS.includes('svg'));
  assert.ok(config.FORBID_TAGS.includes('template'));
  assert.ok(config.FORBID_ATTR.includes('style'));
  assert.match('https://example.com', config.ALLOWED_URI_REGEXP);
  assert.doesNotMatch('javascript:alert(1)', config.ALLOWED_URI_REGEXP);
});

test('NativelyInterface streams through the shared markdown sanitizer', () => {
  const source = read('src/components/NativelyInterface.tsx');

  assert.match(source, /renderSafeStreamingMarkdown/);
  assert.match(source, /node\.innerHTML = renderSafeStreamingMarkdown\(streamingTextRef\.current\)/);
  assert.doesNotMatch(source, /import DOMPurify from 'dompurify'/);
  assert.doesNotMatch(source, /import \{ marked \} from 'marked'/);
});

test('DOMPurify is pinned above vulnerable 3.4.4 through package overrides', () => {
  const packageJson = JSON.parse(read('package.json'));
  const packageLock = JSON.parse(read('package-lock.json'));

  assert.match(packageJson.overrides.dompurify, /\^3\.4\.11/);
  assert.equal(packageLock.packages['node_modules/dompurify'].version, '3.4.11');
});
