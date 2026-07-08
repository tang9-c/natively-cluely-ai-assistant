import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('QA report export IPC is wired through main, preload, and renderer types', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ipc, /safeHandle\('export-qa-report'/);
  assert.match(ipc, /showSaveDialog/);
  assert.match(ipc, /QaReportService/);
  assert.match(preload, /exportQaReport:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('export-qa-report'\)/);
  assert.match(types, /exportQaReport:\s*\(\)\s*=>\s*Promise<\{\s*success:\s*boolean;\s*filePath\?:\s*string;\s*error\?:\s*string;\s*cancelled\?:\s*boolean;\s*\}>/s);
});

test('Settings UI places Export Quality Report below Detailed Debug Logs', () => {
  const settings = read('src/components/SettingsOverlay.tsx');
  const debugIndex = settings.indexOf('详细调试日志');
  const exportIndex = settings.indexOf('导出质量报告');
  assert.ok(debugIndex >= 0, 'debug logging row should exist');
  assert.ok(exportIndex > debugIndex, 'export row should appear after debug logging row');
  assert.match(settings, /exportQaReport/);
  assert.match(settings, /Quality report exported|质量报告已导出/);
  assert.match(settings, /Export failed|导出失败/);
});
