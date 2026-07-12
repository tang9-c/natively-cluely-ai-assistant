import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function sliceSafeHandleBlock(source, channel) {
  const channelIndex = source.indexOf(`'${channel}'`);
  assert.ok(channelIndex >= 0, `${channel} channel should exist`);
  const start = source.lastIndexOf('safeHandle(', channelIndex);
  assert.ok(start >= 0, `${channel} handler should exist`);
  const next = source.indexOf('\n  safeHandle(', start + 1);
  return source.slice(start, next >= 0 ? next : undefined);
}

test('generate-what-to-say passes traceSink and persists sourceStatus', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /let whatToAnswerTrace/);
  assert.match(handler, /traceSink:\s*\(trace\)\s*=>/);
  assert.match(handler, /sourceStatus:/);
  assert.match(handler, /ragAttempted/);
  assert.match(handler, /uploadedMaterialHitCount/);
  assert.match(handler, /citationCount/);
});

test('generate-what-to-say preserves trace observability from WhatToAnswerLLM', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /observability:\s*{[\s\S]{0,120}\.\.\.\(whatToAnswerTrace\?\.observability \?\? {}\)/);
});

test('generate-what-to-say does not discard generated answer when trace persistence fails', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /if \(!contextTrace\)/);
  assert.match(handler, /statusCode:\s*'partial-trace-unavailable'/);
  assert.match(handler, /answer,/);
  assert.match(handler, /contextTrace:\s*null/);
  assert.doesNotMatch(handler, /if \(!contextTrace\)[\s\S]{0,400}answer:\s*null/);
});

test('generate-what-to-say sanitizes options and returns stable status codes', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'generate-what-to-say');

  assert.match(handler, /sanitizeGenerateWhatToSayOptions\(options\)/);
  assert.doesNotMatch(handler, /options\?\.uploadedMaterialContext/);
  assert.match(handler, /statusCode:\s*'ok'/);
  assert.match(handler, /contextPreparation\.invalidRequest/);
  assert.match(handler, /statusCode:\s*contextPreparation\.invalidRequest\.statusCode/);
  assert.match(handler, /statusCode:\s*'partial-trace-unavailable'/);
});

test('open-answer-citation resolves persisted citations by answer id and citation id', () => {
  const source = read('electron/ipcHandlers.ts');
  const handler = sliceSafeHandleBlock(source, 'open-answer-citation');

  assert.match(handler, /getAnswerContextTrace\(input\.answerId\)/);
  assert.match(handler, /citation\.citationId === input\.citationId/);
  assert.match(handler, /resolveAnswerCitation/);
  assert.match(handler, /redactForLog/);
});
