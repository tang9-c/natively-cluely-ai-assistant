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

test('local sales STT benchmark script is wired for ignored private assets', () => {
  const pkg = JSON.parse(read('package.json'));
  const script = read('scripts/run-sales-local-stt-benchmark.mjs');

  assert.equal(
    pkg.scripts['test:dynamic-actions:sales-replay:stt-benchmark:local'],
    'npm run build:electron && node scripts/run-sales-local-stt-benchmark.mjs',
  );
  assert.match(script, /--entry sales-real-001/);
  assert.match(script, /audio\/real\/sales/);
  assert.match(script, /transcripts\/real\/sales/);
  assert.match(script, /private\/stt-benchmark/);
  assert.match(script, /mammoth/);
  assert.match(script, /--provider <id>/);
  assert.match(script, /qcloud-auc \| direct-doubao-auc \| local-sensevoice/);
  assert.match(script, /--parameter-group <name>/);
  assert.match(script, /--segmentation-mode <mode>/);
  assert.match(script, /--pre-roll-sec <n>/);
  assert.match(script, /--post-roll-sec <n>/);
  assert.match(script, /--boosting-table-id <id>/);
  assert.match(script, /--sensevoice-term <canonical=variant1\|variant2>/);
  assert.match(script, /customTermCount/);
  assert.match(script, /--boosting-table-name <name>/);
  assert.match(script, /--correct-table-id <id>/);
  assert.match(script, /--correct-table-name <name>/);
  assert.match(script, /--industrial-corpus-context/);
  assert.match(script, /boosting_table_id/);
  assert.match(script, /boosting_table_name/);
  assert.match(script, /correct_table_id/);
  assert.match(script, /correct_table_name/);
  assert.match(script, /corpusConfig/);
  assert.match(script, /blocked_missing_qcloud_credentials/);
  assert.match(script, /blocked_missing_direct_doubao_credentials/);
  assert.match(script, /blocked_missing_local_sensevoice_model/);
  assert.match(script, /gatewayFieldStatus/);
  assert.match(script, /unsupportedFields/);
  assert.match(script, /ignoredOrUnconfirmedFields/);
  assert.match(script, /segmentedRawComparison/);
  assert.match(script, /segmentedDedupedComparison/);
  assert.match(script, /wholeWindowBaselineComparison/);
  assert.match(script, /characterErrorRate/);
  assert.match(script, /keywordRecall/);
  assert.match(script, /referenceAlignmentStatus/);
  assert.match(script, /alignmentSearch/);
  assert.match(script, /bestReferenceOffsetSec/);
  assert.match(script, /includePrivateText/);
  assert.doesNotMatch(script, /replay-manifest\.json/);
  assert.doesNotMatch(script, /广州酒家|禾望电气|德康威尔|康瑞电子|稳健医疗/);
});

test('STT provider matrix scripts are wired and aggregate blocked/failed states', () => {
  const pkg = JSON.parse(read('package.json'));
  const matrix = read('scripts/run-stt-provider-matrix-local.mjs');

  assert.equal(
    pkg.scripts['test:stt:qcloud-auc:matrix'],
    'npm run build:electron && node scripts/run-stt-provider-matrix-local.mjs --providers qcloud-auc --parameter-groups all',
  );
  assert.equal(
    pkg.scripts['test:stt:provider-matrix:local'],
    'npm run build:electron && node scripts/run-stt-provider-matrix-local.mjs',
  );
  assert.match(matrix, /--providers <a,b>/);
  assert.match(matrix, /--parameter-groups <a,b>/);
  assert.match(matrix, /--windows <start:duration/);
  assert.match(matrix, /--pre-roll-sec <n>/);
  assert.match(matrix, /--post-roll-sec <n>/);
  assert.match(matrix, /buildMatrixCases/);
  assert.match(matrix, /passed:\s*0,\s*failed:\s*0,\s*blocked:\s*0,\s*skipped:\s*0/);
  assert.match(matrix, /private\/stt-benchmark\/matrix/);
});

test('STT provider matrix forwards provider and local model options to benchmark children', async () => {
  const matrixSource = read('scripts/run-stt-provider-matrix-local.mjs');
  const benchmarkSource = read('scripts/run-sales-local-stt-benchmark.mjs');
  const requiredOptions = [
    '--boosting-table-id',
    '--boosting-table-name',
    '--correct-table-id',
    '--correct-table-name',
    '--sensevoice-term-correction',
    '--sensevoice-term',
    '--local-channel-profile',
    '--preprocessing-profiles',
    '--normalization-frame-ms',
  ];
  for (const option of requiredOptions) assert.match(matrixSource, new RegExp(option));

  const matrix = await import('../run-stt-provider-matrix-local.mjs');
  const options = matrix.parseMatrixArgs([
    '--entry', 'sales-real-001',
    '--providers', 'qcloud-auc',
    '--boosting-table-id', 'boost-id-a',
    '--boosting-table-name', 'boost-name-a',
    '--correct-table-id', 'correct-id-a',
    '--correct-table-name', 'correct-name-a',
    '--sensevoice-term-correction', 'industrial',
    '--sensevoice-term', 'PLM=皮诶勒姆',
    '--local-channel-profile', 'system',
    '--preprocessing-profiles', 'baseline,soxr',
    '--normalization-frame-ms', '100',
  ]);
  const [testCase] = matrix.buildMatrixCases(options);
  const childArgs = matrix.buildBenchmarkChildArgs(testCase, options);
  for (const [flag, value] of [
    ['--boosting-table-id', 'boost-id-a'],
    ['--boosting-table-name', 'boost-name-a'],
    ['--correct-table-id', 'correct-id-a'],
    ['--correct-table-name', 'correct-name-a'],
    ['--sensevoice-term-correction', 'industrial'],
    ['--sensevoice-term', 'PLM=皮诶勒姆'],
    ['--local-channel-profile', 'system'],
    ['--preprocessing-profile', 'baseline'],
    ['--normalization-frame-ms', '100'],
  ]) {
    const index = childArgs.indexOf(flag);
    assert.notEqual(index, -1, `${flag} missing from child args`);
    assert.equal(childArgs[index + 1], value);
  }

  assert.match(benchmarkSource, /defaultTermCorrections\.js/);
  assert.match(benchmarkSource, /DEFAULT_SENSEVOICE_TERM_CORRECTIONS/);
  assert.doesNotMatch(benchmarkSource, /DOMAIN_KEYWORDS\.map\(\(keyword[\s\S]{0,120}variants:\s*\[\]/);
});

test('STT benchmark configuration fingerprint changes without exposing raw table names', async () => {
  const benchmark = await import('../run-sales-local-stt-benchmark.mjs');
  const base = {
    provider: 'qcloud-auc',
    parameterGroup: 'qcloud-current',
    boostingTableId: '',
    correctTableId: '',
    correctTableName: '',
    sensevoiceTermCorrection: 'off',
    localChannelProfile: 'system',
    preprocessingProfile: 'baseline',
    normalizationFrameMs: 100,
  };
  const left = benchmark.buildBenchmarkConfigurationForProvider({
    ...base,
    boostingTableName: 'private-table-left',
  });
  const right = benchmark.buildBenchmarkConfigurationForProvider({
    ...base,
    boostingTableName: 'private-table-right',
  });

  assert.notEqual(left.configurationFingerprint, right.configurationFingerprint);
  assert.equal(JSON.stringify(left).includes('private-table-left'), false);
  assert.equal(JSON.stringify(right).includes('private-table-right'), false);
  assert.equal(left.hasBoostingTableName, true);
});

test('STT benchmark loads compiled segmentation helper and reports raw/deduped diagnostics', () => {
  const script = read('scripts/run-sales-local-stt-benchmark.mjs');

  assert.match(script, /dist-electron\/electron\/audio\/SttSegmentation\.js/);
  assert.match(script, /buildSttSegmentPlan/);
  assert.match(script, /buildSegmentationDiagnostics/);
  assert.match(script, /rawComparison/);
  assert.match(script, /dedupedComparison/);
  assert.match(script, /partial_segment_failure/);
});

test('STT provider matrix preserves segmentation diagnostics in aggregate cases', () => {
  const matrix = read('scripts/run-stt-provider-matrix-local.mjs');

  assert.match(matrix, /segmentationDiagnostics/);
  assert.match(matrix, /rawComparison/);
  assert.match(matrix, /dedupedComparison/);
  assert.match(matrix, /preRollSec/);
  assert.match(matrix, /postRollSec/);
});

test('SenseVoice correction diagnostics keep raw and corrected metrics separate', () => {
  const script = read('scripts/run-sales-local-stt-benchmark.mjs');

  assert.match(script, /termCorrectionDiagnostics/);
  assert.match(script, /rawComparison/);
  assert.match(script, /correctedComparison/);
  assert.match(script, /keywordRecallDelta/);
  assert.match(script, /correctionHitCount/);
  assert.doesNotMatch(script, /correctedComparison\s*:\s*comparison,\s*rawComparison\s*:\s*comparison/);
});

test('Doubao table diagnostics are reported separately from dynamic context', () => {
  const script = read('scripts/run-sales-local-stt-benchmark.mjs');

  assert.match(script, /doubaoVocabularyTableDiagnostics/);
  assert.match(script, /boostingTableId/);
  assert.match(script, /correctTableId/);
  assert.match(script, /ignoredOrUnconfirmedFields/);
  assert.match(script, /providerErrorCode/);
  assert.doesNotMatch(script, /industrial-corpus-context[\s\S]{0,300}fallback/);
});

test('STT benchmark compare script is wired for private diff reports', () => {
  const pkg = JSON.parse(read('package.json'));
  const compareScript = path.join(repoRoot, 'scripts/compare-stt-benchmark-reports.mjs');

  assert.equal(pkg.scripts['test:stt:benchmark:compare'], 'node scripts/compare-stt-benchmark-reports.mjs');
  assert.equal(fs.existsSync(compareScript), true);
  const script = fs.readFileSync(compareScript, 'utf8');
  assert.match(script, /--baseline <path>/);
  assert.match(script, /--after <path>/);
  assert.match(script, /--baseline-filter <key=value,key=value>/);
  assert.match(script, /--after-filter <key=value,key=value>/);
  assert.match(script, /averageCharacterErrorRateDelta/);
  assert.match(script, /keywordRecallDelta/);
  assert.match(script, /private\/stt-benchmark\/compare/);
});

test('Doubao corpus field validation script compares id and name variants without private text', () => {
  const pkg = JSON.parse(read('package.json'));
  const validationScript = path.join(repoRoot, 'scripts/run-doubao-corpus-field-validation.mjs');

  assert.equal(
    pkg.scripts['test:stt:doubao-corpus-fields:local'],
    'npm run build:electron && node scripts/run-doubao-corpus-field-validation.mjs',
  );
  assert.equal(fs.existsSync(validationScript), true);
  const script = fs.readFileSync(validationScript, 'utf8');
  assert.match(script, /--boosting-table-id <id>/);
  assert.match(script, /--boosting-table-name <name>/);
  assert.match(script, /--correct-table-id <id>/);
  assert.match(script, /--correct-table-name <name>/);
  assert.match(script, /baseline/);
  assert.match(script, /id-only/);
  assert.match(script, /name-only/);
  assert.match(script, /id-and-name/);
  assert.match(script, /doubao-corpus-field-validation/);
  assert.match(script, /privateReportPath/);
  assert.doesNotMatch(script, /privateTextPreview|includePrivateText/);
});

test('STT benchmark helpers align timestamped transcript windows and score quality', async () => {
  const benchmark = await import('../run-sales-local-stt-benchmark.mjs');
  const rawTranscript = [
    '说话人 1 00:04:58上一段内容',
    '说话人 2 00:05:03我们想了解流体仿真功能和案例',
    '说话人 1 00:05:41还要看PLM和QMS流程集成',
    '说话人 2 00:06:05下一段内容',
  ].join('\n');

  const segments = benchmark.extractTimedTranscriptSegments(rawTranscript);
  const window = benchmark.selectReferenceWindow(segments, { startSec: 300, durationSec: 60 });
  const result = benchmark.compareTranscripts({
    referenceText: window.text,
    hypothesisText: '我们想了解流体仿真功能案例，还要看PLM和QMS流程集成',
  });

  assert.equal(window.status, 'aligned');
  assert.equal(segments.length, 4);
  assert.match(window.text, /流体仿真功能和案例/);
  assert.match(window.text, /PLM和QMS流程集成/);
  assert.ok(result.characterErrorRate < 0.35, `unexpected CER ${result.characterErrorRate}`);
  assert.ok(result.keywordRecall >= 0.75, `unexpected keyword recall ${result.keywordRecall}`);
  assert.deepEqual(result.missingKeywords, []);
});

test('benchmark status excludes invalid reference windows and never gates on best offset', () => {
  const script = read('scripts/run-sales-local-stt-benchmark.mjs');
  assert.match(script, /invalid_boundary_window/);
  assert.match(script, /diagnosticOnly:\s*true/);
  const buildStatus = script.slice(script.indexOf('function buildStatus'), script.indexOf('function buildReportPayload'));
  assert.doesNotMatch(buildStatus, /bestComparison|bestReferenceOffsetSec/);
});

test('provider matrix counts invalid references separately from model failures', () => {
  const matrix = read('scripts/run-stt-provider-matrix-local.mjs');
  assert.match(matrix, /invalidReference/);
  assert.match(matrix, /invalid_boundary_window/);
});

test('STT benchmark diagnostics flag likely mismatch causes without private text', async () => {
  const benchmark = await import('../run-sales-local-stt-benchmark.mjs');
  const result = benchmark.compareTranscripts({
    referenceText: '我们要评估流体仿真、PLM、QMS和ERP集成案例',
    hypothesisText: '我们要评估系统功能',
  });
  const diagnostics = benchmark.diagnoseSttBenchmark({
    comparison: result,
    referenceAlignmentStatus: 'aligned',
    transcriptLength: result.hypothesisChars,
  });

  assert.ok(diagnostics.causes.includes('domain_terms_missed'));
  assert.ok(diagnostics.causes.includes('stt_under_transcribed_or_clip_mismatch'));
  assert.ok(diagnostics.summary.length > 0);
  assert.doesNotMatch(JSON.stringify(diagnostics), /流体仿真|PLM|QMS|ERP/);
});

test('STT benchmark diagnostics flags threshold-level length ratio failures', async () => {
  const benchmark = await import('../run-sales-local-stt-benchmark.mjs');
  const result = benchmark.compareTranscripts({
    referenceText: '我们今天要评估质量流程集成方案以及案例效果',
    hypothesisText: '我们今天要评估质量流程集成方案',
  });
  const diagnostics = benchmark.diagnoseSttBenchmark({
    comparison: result,
    referenceAlignmentStatus: 'aligned',
    transcriptLength: result.hypothesisChars,
  });

  assert.ok(result.lengthRatio >= 0.55 && result.lengthRatio < 0.75);
  assert.ok(diagnostics.causes.includes('low_length_ratio'));
});

test('STT benchmark can detect a better shifted reference window', async () => {
  const benchmark = await import('../run-sales-local-stt-benchmark.mjs');
  const segments = benchmark.extractTimedTranscriptSegments([
    '说话人 1 00:05:00上一段没有关系',
    '说话人 1 00:05:20我们要评估PLM和QMS流程集成案例',
    '说话人 1 00:05:50下一段没有关系',
  ].join('\n'));
  const alignment = benchmark.findBestReferenceWindow(segments, {
    startSec: 300,
    durationSec: 20,
    alignmentSearchSec: 30,
    alignmentSearchStepSec: 5,
  }, '我们要评估PLM和QMS流程集成案例');

  assert.equal(alignment.bestReferenceOffsetSec, 20);
  assert.ok(alignment.bestComparison.characterErrorRate < 0.05);
  assert.ok(alignment.nominalComparison.characterErrorRate > alignment.bestComparison.characterErrorRate);
});

test('STT benchmark de-duplicates overlapped segment text deterministically', async () => {
  const benchmark = await import('../run-sales-local-stt-benchmark.mjs');
  const deduped = benchmark.dedupeOverlappedTranscript([
    '我们要评估PLM和QMS流程',
    'PLM和QMS流程集成案例',
  ]);

  assert.equal(deduped, '我们要评估PLM和QMS流程 集成案例');
});
