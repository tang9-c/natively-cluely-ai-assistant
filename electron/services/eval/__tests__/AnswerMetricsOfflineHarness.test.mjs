import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../../..');

async function loadMetrics() {
  const modulePath = path.resolve(root, 'dist-electron/electron/services/eval/AnswerGroundednessMetrics.js');
  return import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
}

test('offline metrics catch citation recall, groundedness, and refusal regressions', async () => {
  const {
    computeCitationRecall,
    computeGroundednessScore,
    computeRefusalAccuracy,
    evaluateRollbackGates,
  } = await loadMetrics();

  assert.equal(computeCitationRecall(['c1', 'c2'], ['c1']), 0.5);
  assert.equal(computeGroundednessScore([{ supported: true }, { supported: false }]), 0.5);
  assert.equal(computeRefusalAccuracy([{ unsupported: true, refused: true }, { unsupported: true, refused: false }]), 0.5);

  const gates = evaluateRollbackGates({
    citationRecall: 0.5,
    groundedness: 0.75,
    refusalAccuracy: 0.5,
    scopeLeakCount: 0,
    staleCitationOpenedCount: 0,
    p1UiMismatchCount: 0,
  });

  assert.equal(gates.passed, false);
  assert.deepEqual(
    gates.failedReasons.sort(),
    ['citation_recall_below_threshold', 'refusal_accuracy_below_threshold'].sort(),
  );
});
