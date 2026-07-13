import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('test:all uses the stage aggregation runner instead of a short-circuit shell chain', () => {
  const pkg = JSON.parse(read('package.json'));
  const runner = read('scripts/run-test-all.mjs');

  assert.equal(pkg.scripts['test:all'], 'node scripts/run-test-all.mjs');
  assert.match(runner, /const stages = \[/);
  assert.match(runner, /results = stages\.map\(runStage\)/);
  assert.match(runner, /failedStages=/);
  assert.match(runner, /--list-stages/);
  assert.doesNotMatch(pkg.scripts['test:all'], /&&/);
});

test('test:all runner keeps E2E and bench stages visible after node test failures', () => {
  const runner = read('scripts/run-test-all.mjs');

  assert.match(runner, /name: 'node-tests'/);
  assert.match(runner, /name: 'e2e'/);
  assert.match(runner, /name: 'doubao-auc-real'/);
  assert.match(runner, /name: 'screen-understanding-bench'/);
  assert.doesNotMatch(runner, /break;/);
});

test('test:all skips the live Doubao AUC request unless explicitly enabled', () => {
  const runner = read('scripts/run-test-all.mjs');

  assert.match(runner, /DOUBAO_AUC_REAL_TESTS/);
  assert.match(runner, /result=SKIP/);
  assert.match(runner, /set DOUBAO_AUC_REAL_TESTS=1/);
  assert.match(runner, /name: 'doubao-auc-real'[\s\S]*skipUnless:/);
});

test('test:all loads dotenv before checking blocked live STT stages', () => {
  const runner = read('scripts/run-test-all.mjs');

  assert.match(runner, /import ['"]dotenv\/config['"]/);
  assert.match(runner, /blockedOnMissingEnv/);
});

test('test:all runs dynamic action product replay metrics and privacy gates before real STT', () => {
  const runner = read('scripts/run-test-all.mjs');
  const order = [
    "name: 'dynamic-actions-product'",
    "name: 'dynamic-actions-replay'",
    "name: 'dynamic-actions-metrics'",
    "name: 'dynamic-actions-privacy'",
    "name: 'sales-real-stt-replay'",
  ].map((needle) => runner.indexOf(needle));

  assert.ok(order.every((index) => index >= 0), 'all dynamic action gate stages should be present');
  assert.deepEqual([...order].sort((a, b) => a - b), order);
  assert.match(runner, /args: \['scripts\/assert-dynamic-action-report-privacy\.mjs'\]/);
});
