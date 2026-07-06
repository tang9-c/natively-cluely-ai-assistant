import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('realtime diagnostics summary IPC uses persisted aggregate and exposes preload/type APIs', () => {
  const ipc = read('electron/ipcHandlers.ts');
  const db = read('electron/db/DatabaseManager.ts');
  const preload = read('electron/preload.ts');
  const types = read('src/types/electron.d.ts');

  assert.match(ipc, /quality:get-realtime-diagnostics-summary/);
  assert.match(ipc, /DatabaseManager\.getInstance\(\)\.getRealtimeDiagnosticsAggregate/);
  assert.match(ipc, /buildRealtimeDiagnosticsSummary/);
  assert.doesNotMatch(ipc, /degradedReasons:\s*\{\}/);
  assert.doesNotMatch(ipc, /sourceStatusCounts:\s*\{\}/);
  assert.doesNotMatch(ipc, /sampleSize:\s*metrics\.shownCount/);
  assert.doesNotMatch(ipc, /getContextQualityDiagnosticsCollector\(\)\.snapshot\(\)[\s\S]{0,300}quality:get-realtime-diagnostics-summary/);

  assert.match(db, /getRealtimeDiagnosticsAggregate/);
  assert.match(db, /traceSampleSize/);
  assert.match(db, /eventSampleSize/);
  assert.match(db, /sourceStatusCounts/);
  assert.match(db, /degradedReasons/);

  assert.match(preload, /getRealtimeDiagnosticsSummary/);
  assert.match(preload, /quality:get-realtime-diagnostics-summary/);

  assert.match(types, /interface RealtimeDiagnosticsSummary/);
  assert.match(types, /traceSampleSize: number/);
  assert.match(types, /eventSampleSize: number/);
  assert.match(types, /getRealtimeDiagnosticsSummary/);
});
