import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('default context preparation wires the current LLMHelper into the native MCP agent', () => {
  const source = read('electron/services/context/WhatToSayContextPreparation.ts');
  assert.match(source, /llmHelper\?:\s*LLMHelper/);
  assert.match(source, /new McpAgentLoop/);
  assert.match(source, /createSelectedModelToolAdapter\(llmHelper/);
  assert.doesNotMatch(source, /createWindchillBusinessContextAdapter/);
});

test('generate-what-to-say passes the current LLMHelper to context preparation', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("'generate-what-to-say'");
  const end = source.indexOf("safeHandle(", start + 20);
  const handler = source.slice(start, end > start ? end : undefined);
  assert.match(handler, /llmHelper:\s*appState\.processingHelper\.getLLMHelper\(\)/);
});

test('connection testing initializes and lists tools for every source kind without calling a business tool', () => {
  const source = read('electron/ipcHandlers.ts');
  const start = source.indexOf("safeHandle('business-system:test-source'");
  const end = source.indexOf("safeHandle('switch-to-custom-provider'", start);
  const handler = source.slice(start, end);
  assert.doesNotMatch(handler, /source\.kind\s*===\s*['"]plm['"]/);
  assert.match(handler, /client\.connect\(6000\)/);
  assert.match(handler, /client\.listTools\(6000\)/);
  assert.match(handler, /client\.close\(\)/);
  assert.doesNotMatch(handler, /business_context\.query|BusinessMcpClient/);
});

test('native MCP capability gate is hidden, defaults on, and has no renderer IPC control', () => {
  const settings = read('electron/services/SettingsManager.ts');
  const preload = read('electron/preload.ts');
  const ipc = read('electron/ipcHandlers.ts');
  assert.match(settings, /nativeMcpToolCallingEnabled\?:\s*boolean/);
  assert.match(settings, /getNativeMcpToolCallingEnabled[\s\S]*!==\s*false/);
  assert.doesNotMatch(preload, /nativeMcpToolCallingEnabled/);
  assert.doesNotMatch(ipc, /setNativeMcpToolCallingEnabled|native-mcp-tool-calling/);
});
