export function rssRecoveryLimit(stableStartRssBytes) {
  return Math.max(
    stableStartRssBytes * 1.2,
    stableStartRssBytes + 200 * 1024 * 1024,
  );
}

export function linearSlope(samples, selectValue) {
  const points = samples
    .map(sample => ({ x: sample.elapsedMs / 60_000, y: selectValue(sample) }))
    .filter(point => Number.isFinite(point.y));
  if (points.length < 2) return null;
  const xMean = points.reduce((sum, point) => sum + point.x, 0) / points.length;
  const yMean = points.reduce((sum, point) => sum + point.y, 0) / points.length;
  const denominator = points.reduce((sum, point) => sum + (point.x - xMean) ** 2, 0);
  if (denominator === 0) return null;
  return points.reduce(
    (sum, point) => sum + (point.x - xMean) * (point.y - yMean),
    0,
  ) / denominator;
}

function checkpoint(samples, name) {
  const found = samples.find(sample => sample.checkpoint === name);
  if (!found) throw new Error(`Missing benchmark checkpoint ${name}`);
  return found;
}

export function summarizeLongMeetingRun(input) {
  const samples = input.samples;
  const checkpoints = {
    T0: checkpoint(samples, 'T0'),
    T1: checkpoint(samples, 'T1'),
    T2: checkpoint(samples, 'T2'),
  };
  const meetingSamples = samples.filter(sample => sample.phase === 'meeting');
  const rssLimit = rssRecoveryLimit(checkpoints.T0.main.rssBytes);
  const queuesAtT2 = [
    checkpoints.T2.stt.queuedTasks,
    checkpoints.T2.stt.pendingAudio,
    checkpoints.T2.rag.pending,
    checkpoints.T2.rag.processing,
    checkpoints.T2.ipc.pending,
  ];
  const monotonicSegments = meetingSamples.every((sample, index) => (
    index === 0 || sample.session.fullSegments >= meetingSamples[index - 1].session.fullSegments
  ));
  const domBounded = samples.every(sample => {
    const { transcriptRenderedRows, transcriptTotalRows } = sample.renderer;
    return transcriptRenderedRows == null
      || transcriptTotalRows == null
      || transcriptTotalRows <= 40
      || transcriptRenderedRows < 40;
  });

  return {
    schemaVersion: 1,
    environment: input.environment,
    configuration: input.configuration,
    availability: input.availability ?? {},
    samples,
    summary: {
      peakRssBytes: Math.max(...samples.map(sample => sample.main.rssBytes)),
      peakHeapUsedBytes: Math.max(...samples.map(sample => sample.main.heapUsedBytes)),
      rssSlopeBytesPerMinute: linearSlope(meetingSamples, sample => sample.main.rssBytes),
      heapSlopeBytesPerMinute: linearSlope(meetingSamples, sample => sample.main.heapUsedBytes),
      maxQueueDepths: {
        sttQueued: Math.max(...samples.map(sample => sample.stt.queuedTasks)),
        sttPendingAudio: Math.max(...samples.map(sample => sample.stt.pendingAudio)),
        ragPending: Math.max(...samples.map(sample => sample.rag.pending)),
        ipcPending: Math.max(...samples.map(sample => sample.ipc.pending)),
      },
    },
    checkpoints,
    acceptance: {
      rssRecovered: {
        pass: checkpoints.T2.main.rssBytes <= rssLimit,
        actual: checkpoints.T2.main.rssBytes,
        limit: rssLimit,
      },
      queuesReleased: {
        pass: queuesAtT2.every(value => value === 0),
        actual: queuesAtT2.reduce((sum, value) => sum + value, 0),
        limit: 0,
      },
      transcriptMonotonic: { pass: monotonicSegments, actual: monotonicSegments, limit: true },
      domBounded: { pass: domBounded, actual: domBounded, limit: true },
    },
  };
}

export function renderLongMeetingMarkdown(report) {
  const acceptanceRows = Object.entries(report.acceptance)
    .map(([name, value]) => `| ${name} | ${value.pass ? 'PASS' : 'FAIL'} | ${value.actual} | ${value.limit} |`)
    .join('\n');
  const availabilityRows = Object.entries(report.availability)
    .map(([name, reason]) => `| ${name} | ${reason ?? 'available'} |`)
    .join('\n');
  return `# CueUp Long Meeting Benchmark\n\n` +
    `- Platform: ${report.environment.platform} ${report.environment.arch}\n` +
    `- Source: ${report.configuration.source}\n` +
    `- Duration: ${report.configuration.durationMinutes} minutes\n\n` +
    `## Summary\n\n| Metric | Value |\n| --- | ---: |\n` +
    `| Peak RSS | ${report.summary.peakRssBytes} |\n` +
    `| RSS slope/min | ${report.summary.rssSlopeBytesPerMinute} |\n\n` +
    `## Acceptance\n\n| Check | Result | Actual | Limit |\n| --- | --- | ---: | ---: |\n${acceptanceRows}\n\n` +
    `## Availability\n\n| Metric | Status |\n| --- | --- |\n${availabilityRows}\n`;
}
