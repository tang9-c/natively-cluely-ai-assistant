// IpcContract.test.mjs
// TDD-driven coverage build for ipcHandlers.ts IPC channels.
// First cycle target: get-verbose-logging (zero-input, boolean-return, no side effects).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

test('get-verbose-logging IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler registered with exact channel name
  assert.match(
    ipc,
    /safeHandle\(\s*['"]get-verbose-logging['"]\s*,\s*async\s*\(\s*\)\s*=>\s*appState\.getVerboseLogging\(\)\s*\)\s*;/,
    'ipcHandlers.ts must register get-verbose-logging with exact channel name and body',
  );

  // 2. preload: renderer-facing method invokes the same channel name
  assert.match(
    preload,
    /getVerboseLogging:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]get-verbose-logging['"]\s*\)\s*,/,
    'preload.ts must expose getVerboseLogging() invoking the same channel name',
  );

  // 3. renderer types: channel name appears at least once for cross-reference traceability
  // RED constraint: types file currently does NOT mention the channel name literally.
  // This test will FAIL until the types file is annotated with the channel name.
  assert.match(
    types,
    /get-verbose-logging/,
    'src/types/electron.d.ts must reference the channel name "get-verbose-logging" for traceability',
  );

  // 4. renderer types: return type matches boolean contract
  assert.match(
    types,
    /getVerboseLogging:\s*\(\s*\)\s*=>\s*Promise<\s*boolean\s*>\s*;/,
    'src/types/electron.d.ts must declare getVerboseLogging() returning Promise<boolean>',
  );
});

test('set-verbose-logging IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler registered with channel name + bool arg + return {success: true}
  assert.match(
    ipc,
    /safeHandle\(\s*['"]set-verbose-logging['"]\s*,\s*async\s*\(\s*_,\s*enabled:\s*boolean\s*\)\s*=>/,
    'ipcHandlers.ts must register set-verbose-logging with channel name and boolean arg',
  );

  // 2. preload: setter takes boolean, invokes channel with that boolean
  assert.match(
    preload,
    /setVerboseLogging:\s*\(\s*enabled:\s*boolean\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]set-verbose-logging['"]\s*,\s*enabled\s*\)\s*,/,
    'preload.ts must expose setVerboseLogging(enabled) invoking channel with the boolean',
  );

  // 3. renderer types: channel name referenced for traceability (RED: absent today)
  assert.match(
    types,
    /set-verbose-logging/,
    'src/types/electron.d.ts must reference the channel name "set-verbose-logging" for traceability',
  );

  // 4. renderer types: setter returns Promise<{ success: boolean }>
  assert.match(
    types,
    /setVerboseLogging:\s*\(\s*enabled:\s*boolean\s*\)\s*=>\s*Promise<\s*\{\s*success:\s*boolean\s*\}\s*>\s*;/,
    'src/types/electron.d.ts must declare setVerboseLogging returning Promise<{success:boolean}>',
  );
});

test('get-meeting-retention IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler registered with channel name
  assert.match(
    ipc,
    /safeHandle\(\s*['"]get-meeting-retention['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register get-meeting-retention with channel name',
  );

  // 2. preload: renderer-facing method invokes the same channel name
  assert.match(
    preload,
    /getMeetingRetention:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]get-meeting-retention['"]\s*\)\s*,/,
    'preload.ts must expose getMeetingRetention() invoking the same channel name',
  );

  // 3. renderer types: channel name referenced for traceability (RED: absent today)
  assert.match(
    types,
    /get-meeting-retention/,
    'src/types/electron.d.ts must reference the channel name "get-meeting-retention" for traceability',
  );

  // 4. renderer types: return type matches enum contract
  assert.match(
    types,
    /getMeetingRetention:\s*\(\s*\)\s*=>\s*Promise<\s*['"]forever['"]\s*\|\s*['"]7d['"]\s*\|\s*['"]30d['"]\s*\|\s*['"]never['"]\s*>\s*;/,
    'src/types/electron.d.ts must declare getMeetingRetention returning Promise<forever|7d|30d|never>',
  );
});

test('set-meeting-retention IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler validates retention enum and rejects invalid values
  assert.match(
    ipc,
    /safeHandle\(\s*['"]set-meeting-retention['"]\s*,\s*async\s*\(\s*_,\s*retention:\s*['"]forever['"]\s*\|\s*['"]7d['"]\s*\|\s*['"]30d['"]\s*\|\s*['"]never['"]\s*\)\s*=>/,
    'ipcHandlers.ts must register set-meeting-retention with enum arg',
  );
  assert.match(
    ipc,
    /safeHandle\(\s*['"]set-meeting-retention['"][\s\S]{0,400}?['"]invalid_retention['"]/,
    'set-meeting-retention handler must return {success:false, error:invalid_retention} on bad input',
  );

  // 2. preload: setter takes enum, invokes channel with enum value
  assert.match(
    preload,
    /setMeetingRetention:\s*\(\s*retention:\s*['"]forever['"]\s*\|\s*['"]7d['"]\s*\|\s*['"]30d['"]\s*\|\s*['"]never['"]\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]set-meeting-retention['"]\s*,\s*retention\s*\)\s*,/,
    'preload.ts must expose setMeetingRetention(retention) invoking channel with the enum',
  );

  // 3. renderer types: channel name referenced for traceability (RED: absent today)
  assert.match(
    types,
    /set-meeting-retention/,
    'src/types/electron.d.ts must reference the channel name "set-meeting-retention" for traceability',
  );

  // 4. renderer types: setter returns Promise<{success: boolean; error?: string}>
  assert.match(
    types,
    /setMeetingRetention:\s*\(\s*retention:\s*['"]forever['"]\s*\|\s*['"]7d['"]\s*\|\s*['"]30d['"]\s*\|\s*['"]never['"]\s*\)\s*=>\s*Promise<\s*\{\s*success:\s*boolean\s*;\s*error\?:\s*string\s*\}\s*>\s*;/,
    'src/types/electron.d.ts must declare setMeetingRetention returning Promise<{success:boolean;error?:string}>',
  );
});

test('get-provider-data-scopes IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process
  assert.match(
    ipc,
    /safeHandle\(\s*['"]get-provider-data-scopes['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register get-provider-data-scopes',
  );

  // 2. preload
  assert.match(
    preload,
    /getProviderDataScopes:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]get-provider-data-scopes['"]\s*\)\s*,/,
    'preload.ts must expose getProviderDataScopes invoking the channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /get-provider-data-scopes/,
    'src/types/electron.d.ts must reference channel name "get-provider-data-scopes"',
  );

  // 4. types: return type is a scopes record
  assert.match(
    types,
    /getProviderDataScopes:\s*\(\s*\)\s*=>\s*Promise<\s*\{[^}]*transcript[^}]*\}\s*>\s*;/,
    'src/types/electron.d.ts must declare getProviderDataScopes returning Promise<{transcript?:boolean, ...}>',
  );
});

test('set-provider-data-scopes IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler validates scopes arg is an object and rejects invalid input
  assert.match(
    ipc,
    /safeHandle\(\s*['"]set-provider-data-scopes['"]\s*,\s*async\s*\(\s*_,\s*scopes:\s*Record<string,\s*boolean>\s*\)\s*=>/,
    'ipcHandlers.ts must register set-provider-data-scopes with Record<string,boolean> arg',
  );
  assert.match(
    ipc,
    /safeHandle\(\s*['"]set-provider-data-scopes['"][\s\S]{0,400}?['"]invalid_scopes['"]/,
    'set-provider-data-scopes handler must reject non-object scopes with invalid_scopes error',
  );

  // 2. preload
  assert.match(
    preload,
    /setProviderDataScopes:\s*\(\s*scopes:\s*(?:Record<string,\s*boolean>|any)\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]set-provider-data-scopes['"]\s*,\s*scopes\s*\)\s*,/,
    'preload.ts must expose setProviderDataScopes invoking channel with scopes',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /set-provider-data-scopes/,
    'src/types/electron.d.ts must reference channel name "set-provider-data-scopes"',
  );

  // 4. types: setter returns Promise<{success: boolean; error?: string}>
  assert.match(
    types,
    /setProviderDataScopes:\s*\(\s*scopes:\s*\{[^}]*transcript[^}]*\}\s*\)\s*=>\s*Promise<\s*\{\s*success:\s*boolean\s*;\s*error\?:\s*string\s*\}\s*>\s*;/,
    'src/types/electron.d.ts must declare setProviderDataScopes returning Promise<{success:boolean;error?:string}>',
  );
});

test('get-screen-understanding-mode IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process
  assert.match(
    ipc,
    /safeHandle\(\s*['"]get-screen-understanding-mode['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register get-screen-understanding-mode',
  );

  // 2. preload
  assert.match(
    preload,
    /getScreenUnderstandingMode:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]get-screen-understanding-mode['"]\s*\)\s*,/,
    'preload.ts must expose getScreenUnderstandingMode invoking the channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /get-screen-understanding-mode/,
    'src/types/electron.d.ts must reference channel name "get-screen-understanding-mode"',
  );

  // 4. types: return type is a 3-value enum
  assert.match(
    types,
    /getScreenUnderstandingMode:\s*\(\s*\)\s*=>\s*Promise<\s*['"]vision_first['"]\s*\|\s*['"]vision_only['"]\s*\|\s*['"]private_vision['"]\s*>\s*;/,
    'src/types/electron.d.ts must declare getScreenUnderstandingMode returning Promise<vision_first|vision_only|private_vision>',
  );
});

test('speaker-verification:enroll IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const pcm = read('electron/services/speaker/speakerEnrollmentPcm.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler accepts samples array
  assert.match(
    ipc,
    /safeHandle\(\s*['"]speaker-verification:enroll['"]\s*,\s*async\s*\(\s*_,\s*samples:\s*any\[\]\s*\)\s*=>/,
    'ipcHandlers.ts must register speaker-verification:enroll with samples arg',
  );

  // 2. preload: renderer-facing method invokes namespaced channel
  assert.match(
    preload,
    /speakerVerificationEnroll:\s*\(\s*samples:\s*[^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]speaker-verification:enroll['"]\s*,\s*samples\s*\)\s*,/,
    'preload.ts must expose speakerVerificationEnroll invoking namespaced channel',
  );
  assert.match(
    preload,
    /pcm16\?:\s*ArrayBuffer/,
    'preload.ts must allow pcm16 ArrayBuffer enrollment samples',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /speaker-verification:enroll/,
    'src/types/electron.d.ts must reference channel name "speaker-verification:enroll"',
  );

  // 4. types: enrollment returns Promise<{success: boolean; status?: ...; error?: string}>
  assert.match(
    types,
    /speakerVerificationEnroll:[\s\S]*?Promise<\s*\{[\s\S]*?success:\s*boolean[\s\S]*?error\?:\s*string[\s\S]*?\}\s*>\s*;/,
    'src/types/electron.d.ts must declare speakerVerificationEnroll returning Promise with success+error fields',
  );
  assert.match(
    types,
    /pcm16\?:\s*ArrayBuffer/,
    'src/types/electron.d.ts must allow pcm16 ArrayBuffer enrollment samples',
  );
  assert.match(
    ipc,
    /normalizeSpeakerEnrollmentSample/,
    'ipcHandlers.ts must normalize enrollment samples before enrollment',
  );
  assert.match(
    pcm,
    /decodeSpeakerEnrollmentPcm16/,
    'speaker PCM helper must decode little-endian PCM16 enrollment samples',
  );
  assert.match(
    pcm,
    /Array\.isArray\(sample\?\.samples\)[\s\S]*?new Float32Array\(sample\.samples\)/,
    'speaker PCM helper must keep legacy number[] enrollment compatibility',
  );
});

test('set-window-mode IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler accepts mode enum + optional inactive flag
  assert.match(
    ipc,
    /safeHandle\(\s*['"]set-window-mode['"]\s*,\s*async\s*\(\s*event\s*,\s*mode:\s*['"]launcher['"]\s*\|\s*['"]overlay['"]\s*,\s*inactive\?:\s*boolean\s*\)\s*=>/,
    'ipcHandlers.ts must register set-window-mode with mode enum + optional inactive flag',
  );

  // 2. preload
  assert.match(
    preload,
    /setWindowMode:\s*\([^)]*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]set-window-mode['"]\s*[^)]*\)\s*,/,
    'preload.ts must expose setWindowMode invoking channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /set-window-mode/,
    'src/types/electron.d.ts must reference channel name "set-window-mode"',
  );

  // 4. types: setWindowMode declares mode enum arg
  assert.match(
    types,
    /setWindowMode:[\s\S]*?['"]launcher['"][\s\S]*?['"]overlay['"]/,
    'src/types/electron.d.ts must declare setWindowMode with launcher|overlay enum',
  );
});

test('get-log-file-path IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process
  assert.match(
    ipc,
    /safeHandle\(\s*['"]get-log-file-path['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register get-log-file-path',
  );

  // 2. preload
  assert.match(
    preload,
    /getLogFilePath:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]get-log-file-path['"]\s*\)\s*,/,
    'preload.ts must expose getLogFilePath invoking the channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /get-log-file-path/,
    'src/types/electron.d.ts must reference channel name "get-log-file-path"',
  );

  // 4. types: returns Promise<string>
  assert.match(
    types,
    /getLogFilePath:\s*\(\s*\)\s*=>\s*Promise<\s*string(?:\s*\|\s*null)?\s*>\s*;/,
    'src/types/electron.d.ts must declare getLogFilePath returning Promise<string|null>',
  );
});

test('get-meeting-active IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process
  assert.match(
    ipc,
    /safeHandle\(\s*['"]get-meeting-active['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register get-meeting-active',
  );

  // 2. preload
  assert.match(
    preload,
    /getMeetingActive:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]get-meeting-active['"]\s*\)\s*,/,
    'preload.ts must expose getMeetingActive invoking the channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /get-meeting-active/,
    'src/types/electron.d.ts must reference channel name "get-meeting-active"',
  );

  // 4. types: returns Promise<boolean>
  assert.match(
    types,
    /getMeetingActive:\s*\(\s*\)\s*=>\s*Promise<\s*boolean\s*>\s*;?/,
    'src/types/electron.d.ts must declare getMeetingActive returning Promise<boolean>',
  );
});

test('take-screenshot IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler returns {path, preview}
  assert.match(
    ipc,
    /safeHandle\(\s*['"]take-screenshot['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register take-screenshot',
  );

  // 2. preload
  assert.match(
    preload,
    /takeScreenshot:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]take-screenshot['"]\s*\)\s*,/,
    'preload.ts must expose takeScreenshot invoking the channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /take-screenshot/,
    'src/types/electron.d.ts must reference channel name "take-screenshot"',
  );

  // 4. types: returns Promise<{path: string; preview: string}>
  assert.match(
    types,
    /takeScreenshot:\s*\(\s*\)\s*=>\s*Promise<\s*\{\s*path:\s*string\s*;[^}]*preview[^}]*\}\s*>\s*;?/,
    'src/types/electron.d.ts must declare takeScreenshot returning Promise<{path:string;preview:string}>',
  );
});

test('delete-screenshot IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler accepts filePath string
  assert.match(
    ipc,
    /safeHandle\(\s*['"]delete-screenshot['"]\s*,\s*async\s*\(\s*event\s*,\s*filePath:\s*string\s*\)\s*=>/,
    'ipcHandlers.ts must register delete-screenshot with filePath string arg',
  );

  // 2. preload
  assert.match(
    preload,
    /deleteScreenshot:\s*\(\s*path:\s*string\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]delete-screenshot['"]\s*,\s*path\s*\)\s*,/,
    'preload.ts must expose deleteScreenshot invoking channel with path',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /delete-screenshot/,
    'src/types/electron.d.ts must reference channel name "delete-screenshot"',
  );

  // 4. types: returns Promise<{success: boolean; error?: string}>
  assert.match(
    types,
    /deleteScreenshot:\s*\(\s*path:\s*string\s*\)\s*=>\s*Promise<\s*\{\s*success:\s*boolean\s*;[^}]*error\?:\s*string\s*\}\s*>\s*;?/,
    'src/types/electron.d.ts must declare deleteScreenshot returning Promise<{success:boolean;error?:string}>',
  );
});

test('toggle-window IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process
  assert.match(
    ipc,
    /safeHandle\(\s*['"]toggle-window['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register toggle-window',
  );

  // 2. preload
  assert.match(
    preload,
    /toggleWindow:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]toggle-window['"]\s*\)\s*,/,
    'preload.ts must expose toggleWindow invoking the channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /toggle-window/,
    'src/types/electron.d.ts must reference channel name "toggle-window"',
  );

  // 4. types: returns Promise<void>
  assert.match(
    types,
    /toggleWindow:\s*\(\s*\)\s*=>\s*Promise<\s*void\s*>\s*;?/,
    'src/types/electron.d.ts must declare toggleWindow returning Promise<void>',
  );
});

test('show-window IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process: handler accepts optional inactive flag
  assert.match(
    ipc,
    /safeHandle\(\s*['"]show-window['"]\s*,\s*async\s*\(\s*event\s*,\s*inactive\?:\s*boolean\s*\)\s*=>/,
    'ipcHandlers.ts must register show-window with optional inactive flag',
  );

  // 2. preload
  assert.match(
    preload,
    /showWindow:\s*\(\s*inactive\?:\s*boolean\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]show-window['"]\s*,\s*inactive\s*\)\s*,/,
    'preload.ts must expose showWindow invoking channel with inactive arg',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /show-window/,
    'src/types/electron.d.ts must reference channel name "show-window"',
  );

  // 4. types: returns Promise<void>
  assert.match(
    types,
    /showWindow:\s*\(\s*inactive\?:\s*boolean\s*\)\s*=>\s*Promise<\s*void\s*>\s*;?/,
    'src/types/electron.d.ts must declare showWindow returning Promise<void>',
  );
});

test('hide-window IPC channel is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  // 1. main process
  assert.match(
    ipc,
    /safeHandle\(\s*['"]hide-window['"]\s*,\s*async\s*\(\s*\)\s*=>/,
    'ipcHandlers.ts must register hide-window',
  );

  // 2. preload
  assert.match(
    preload,
    /hideWindow:\s*\(\s*\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]hide-window['"]\s*\)\s*,/,
    'preload.ts must expose hideWindow invoking the channel',
  );

  // 3. types: channel name traceability (RED: absent today)
  assert.match(
    types,
    /hide-window/,
    'src/types/electron.d.ts must reference channel name "hide-window"',
  );

  // 4. types: returns Promise<void>
  assert.match(
    types,
    /hideWindow:\s*\(\s*\)\s*=>\s*Promise<\s*void\s*>\s*;?/,
    'src/types/electron.d.ts must declare hideWindow returning Promise<void>',
  );
});

test('set-overlay-automatic-interactive is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(
    ipc,
    /safeHandle\(\s*['"]set-overlay-automatic-interactive['"]\s*,\s*async\s*\(\s*_,\s*interactive:\s*boolean\s*\)\s*=>/,
  );
  assert.match(
    ipc,
    /getWindowHelper\(\)\.setOverlayAutomaticInteractive\(interactive\)/,
  );
  assert.match(
    preload,
    /setOverlayAutomaticInteractive:\s*\(interactive:\s*boolean\)\s*=>\s*ipcRenderer\.invoke\(\s*['"]set-overlay-automatic-interactive['"]\s*,\s*interactive\s*\)/,
  );
  assert.match(types, /@ipc-channel set-overlay-automatic-interactive/);
  assert.match(
    types,
    /setOverlayAutomaticInteractive:\s*\(\s*interactive:\s*boolean,?\s*\)\s*=>\s*Promise<\{\s*success:\s*boolean;?\s*\}>/,
  );
});
