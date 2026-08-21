const TIMING_FIELDS = [
  'submit',
  'poll',
  'pollWait',
  'providerProcessingLowerBound',
  'providerProcessingUpperBound',
  'parse',
  'submitToFinal',
  'finalToRenderer',
  'endToEnd',
];

const FAILURE_STAGE_MAP = new Map([
  ['submit', 'submit_failed'],
  ['submit_started', 'submit_failed'],
  ['submit_completed', 'submit_failed'],
  ['submit_failed', 'submit_failed'],
  ['poll', 'poll_failed'],
  ['poll_started', 'poll_failed'],
  ['poll_completed', 'poll_failed'],
  ['poll_failed', 'poll_failed'],
  ['parse', 'parse_failed'],
  ['task_completed', 'parse_failed'],
  ['result_parsed', 'parse_failed'],
  ['parse_failed', 'parse_failed'],
  ['renderer', 'renderer_timeout'],
  ['main_route_final', 'renderer_timeout'],
  ['overlay_dom_visible', 'renderer_timeout'],
  ['renderer_timeout', 'renderer_timeout'],
  ['quality', 'quality_rejected'],
  ['quality_rejected', 'quality_rejected'],
  ['runner', 'runner_failed'],
  ['runner_failed', 'runner_failed'],
]);

function finiteNonNegative(values) {
  return values
    .map(Number)
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((left, right) => left - right);
}

export function percentile(values, ratio) {
  const sorted = finiteNonNegative(values);
  if (sorted.length === 0 || !Number.isFinite(ratio) || ratio < 0 || ratio > 1) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1));
  return sorted[index];
}

function summarizeValues(values, suffix = 'Ms') {
  const sorted = finiteNonNegative(values);
  if (sorted.length === 0) return null;
  return {
    sampleCount: sorted.length,
    [`p50${suffix}`]: percentile(sorted, 0.5),
    [`p95${suffix}`]: percentile(sorted, 0.95),
    [`min${suffix}`]: sorted[0],
    [`max${suffix}`]: sorted.at(-1),
  };
}

export function sanitizeFailure(_error, phase) {
  return FAILURE_STAGE_MAP.get(String(phase ?? '').toLowerCase()) ?? 'unknown_failed';
}

function summarizeQuality(validSamples, thresholds) {
  const qualitySamples = validSamples
    .map(sample => sample.quality)
    .filter(quality => quality
      && Number.isFinite(quality.characterErrorRate)
      && Number.isFinite(quality.keywordRecall)
      && Number.isFinite(quality.lengthRatio));

  if (qualitySamples.length !== validSamples.length || qualitySamples.length === 0) {
    return { status: 'missing', passed: false, sampleCount: qualitySamples.length };
  }

  const passed = qualitySamples.every(quality => (
    quality.characterErrorRate <= thresholds.characterErrorRate
    && quality.keywordRecall >= thresholds.keywordRecall
    && quality.lengthRatio >= thresholds.lengthRatio
  ));

  return {
    status: passed ? 'passed' : 'failed',
    passed,
    sampleCount: qualitySamples.length,
    characterErrorRate: summarizeValues(qualitySamples.map(item => item.characterErrorRate), ''),
    keywordRecall: summarizeValues(qualitySamples.map(item => item.keywordRecall), ''),
    lengthRatio: summarizeValues(qualitySamples.map(item => item.lengthRatio), ''),
  };
}

export function summarizeSamples(samples, qualityThresholds = {}) {
  const source = Array.isArray(samples) ? samples : [];
  const validSamples = source.filter(sample => sample?.valid === true);
  const failedSamples = source.filter(sample => sample?.valid !== true);
  const failureStages = {};
  for (const sample of failedSamples) {
    const stage = sanitizeFailure(null, sample?.failureStage);
    failureStages[stage] = (failureStages[stage] ?? 0) + 1;
  }

  const timingsMs = {};
  for (const field of TIMING_FIELDS) {
    timingsMs[field] = summarizeValues(validSamples.map(sample => sample.timingsMs?.[field]));
  }

  const pollRequestValues = finiteNonNegative(validSamples.map(sample => sample.pollRequests));
  const thresholds = {
    characterErrorRate: qualityThresholds.characterErrorRate ?? 0.35,
    keywordRecall: qualityThresholds.keywordRecall ?? 0.75,
    lengthRatio: qualityThresholds.lengthRatio ?? 0.75,
  };

  return {
    totalCount: source.length,
    validCount: validSamples.length,
    failedCount: failedSamples.length,
    failureRate: source.length === 0 ? null : failedSamples.length / source.length,
    failureStages,
    timingsMs,
    pollRequests: {
      p50: percentile(pollRequestValues, 0.5),
      p95: percentile(pollRequestValues, 0.95),
    },
    quality: summarizeQuality(validSamples, thresholds),
  };
}

function comparableCell(cell) {
  const summary = cell?.summary;
  const p95 = summary?.timingsMs?.submitToFinal?.p95Ms;
  return summary?.quality?.passed === true
    && Number.isFinite(summary.failureRate)
    && Number.isFinite(p95)
    ? { cell, failureRate: summary.failureRate, p95, requests: summary.pollRequests?.p50 ?? Infinity }
    : null;
}

export function chooseWinner(cells, currentDefaultId) {
  const comparable = (Array.isArray(cells) ? cells : []).map(comparableCell).filter(Boolean);
  if (comparable.length === 0) return null;

  const lowestFailureRate = Math.min(...comparable.map(item => item.failureRate));
  const reliable = comparable.filter(item => item.failureRate === lowestFailureRate);
  const fastestP95 = Math.min(...reliable.map(item => item.p95));
  const latencyPeers = reliable.filter(item => (
    item.p95 === fastestP95 || (item.p95 - fastestP95) / fastestP95 < 0.05
  ));
  const fewestRequests = Math.min(...latencyPeers.map(item => item.requests));
  const efficient = latencyPeers.filter(item => item.requests === fewestRequests);
  const fastestEfficientP95 = Math.min(...efficient.map(item => item.p95));
  const exactPeers = efficient.filter(item => item.p95 === fastestEfficientP95);
  const current = exactPeers.find(item => item.cell.id === currentDefaultId);
  return (current ?? exactPeers.sort((left, right) => String(left.cell.id).localeCompare(String(right.cell.id)))[0]).cell;
}

export function buildExperimentMatrix({
  pollIntervalsMs = [500, 1000, 2000],
  segmentSeconds = [5, 10, 15],
  parameterGroups = ['qcloud-current', 'qcloud-current-plus-vad'],
  screeningSamples = 10,
  finalistSamples = 30,
} = {}) {
  const stage = (id, cells, dependsOn = null) => ({
    id,
    dependsOn,
    screeningSamples,
    finalistSamples,
    cells,
  });
  return [
    stage('poll', pollIntervalsMs.map(pollIntervalMs => ({
      id: `poll-${pollIntervalMs}`,
      segmentSeconds: 10,
      pollIntervalMs,
      parameterGroup: 'qcloud-current',
    }))),
    stage('segment', segmentSeconds.map(seconds => ({
      id: `segment-${seconds}`,
      segmentSeconds: seconds,
      pollIntervalMs: '$pollWinner',
      parameterGroup: 'qcloud-current',
    })), 'poll'),
    stage('vad', parameterGroups.map(parameterGroup => ({
      id: `vad-${parameterGroup}`,
      segmentSeconds: '$segmentWinner',
      pollIntervalMs: '$pollWinner',
      parameterGroup,
    })), 'segment'),
  ];
}
