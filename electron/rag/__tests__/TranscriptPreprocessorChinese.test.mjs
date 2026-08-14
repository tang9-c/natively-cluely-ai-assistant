import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const { preprocessTranscript } = await import(
  pathToFileURL(path.resolve('dist-electron/electron/rag/TranscriptPreprocessor.js')).href
);

const segment = (text) => [{ speaker: '我', text, timestamp: 1_000 }];

test('keeps meaningful Chinese text without whitespace', () => {
  for (const text of ['数字化移交', '手术机器人', '机器人行业解决方案']) {
    assert.equal(preprocessTranscript(segment(text)).length, 1, text);
  }
});

test('still removes one-character CJK noise and short English text', () => {
  assert.equal(preprocessTranscript(segment('啊')).length, 0);
  assert.equal(preprocessTranscript(segment('go now')).length, 0);
});

test('keeps meaningful mixed-language text with one CJK character', () => {
  assert.equal(preprocessTranscript(segment('AI 在 production is unavailable')).length, 1);
  assert.equal(preprocessTranscript(segment('啊 hello')).length, 0);
});
