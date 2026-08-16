import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('all native audio producers account for rejected ring-buffer writes', () => {
  for (const relativePath of [
    'native-module/src/microphone.rs',
    'native-module/src/speaker/core_audio.rs',
    'native-module/src/speaker/sck.rs',
    'native-module/src/speaker/windows.rs',
  ]) {
    assert.match(read(relativePath), /record_write\s*\(/, relativePath);
  }
});

test('both native capture classes expose numeric buffer diagnostics', () => {
  const source = read('native-module/src/lib.rs');

  assert.equal(source.match(/pub fn get_buffer_diagnostics\s*\(/g)?.length, 2);
  assert.match(source, /dropped_samples:\s*snapshot\.dropped_samples as f64/);
  assert.match(source, /drop_events:\s*snapshot\.drop_events as f64/);
});
